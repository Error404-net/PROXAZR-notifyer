const { app } = require('@azure/functions');

const MAX_BODY_CHARS = Number(process.env.MAX_BODY_CHARS || 10000);

function boolFromEnv(name) {
  return String(process.env[name] || '').toLowerCase() === 'true';
}

function getEnv(name, required = true) {
  const value = process.env[name];
  if (required && (!value || !value.trim())) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getCsv(name, required = false) {
  const raw = process.env[name];
  if (!raw) {
    if (required) throw new Error(`Missing required environment variable: ${name}`);
    return [];
  }
  return raw.split(',').map((v) => v.trim()).filter(Boolean);
}

function redactUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/***`;
  } catch {
    return '***';
  }
}

function truncateText(input, maxChars = MAX_BODY_CHARS) {
  if (!input) return '';
  if (input.length <= maxChars) return input;
  return `${input.slice(0, Math.max(0, maxChars - 16))}\n\n[TRUNCATED]`;
}

function normalizeProxmoxPayload(payload) {
  const source = payload.node || payload.host || payload.cluster || 'proxmox';
  const eventId = payload.id || payload.eventId || payload.uuid || null;
  const severity = String(payload.severity || payload.level || 'info').toLowerCase();

  const title =
    payload.title ||
    payload.subject ||
    payload.message ||
    payload.type ||
    `Proxmox event${eventId ? ` (${eventId})` : ''}`;

  const detailsObj = {
    message: payload.message,
    type: payload.type,
    node: payload.node,
    vmid: payload.vmid,
    status: payload.status,
    timestamp: payload.timestamp || new Date().toISOString()
  };

  const details = truncateText(
    Object.entries(detailsObj)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join('\n')
  );

  return {
    title: String(title),
    severity,
    source: String(source),
    details,
    rawJson: boolFromEnv('INCLUDE_RAW_JSON') ? payload : undefined,
    eventId: eventId ? String(eventId) : undefined
  };
}

function validateSecretHeader(request) {
  const secretHeaderName = (process.env.SECRET_HEADER_NAME || 'x-proxmox-secret').toLowerCase();
  const expectedSecret = getEnv('PROXMOX_WEBHOOK_SECRET');

  const provided = request.headers.get(secretHeaderName);
  if (!provided || provided !== expectedSecret) {
    return false;
  }
  return true;
}

function validateChannels(channels) {
  const allowed = new Set(['email', 'teams']);
  const bad = channels.filter((c) => !allowed.has(c));
  if (bad.length > 0) {
    throw new Error(`Unsupported channel(s): ${bad.join(', ')}`);
  }
}

function formatTextMessage(msg) {
  const lines = [
    `${msg.title}`,
    `severity: ${msg.severity}`,
    `source: ${msg.source}`,
    msg.eventId ? `eventId: ${msg.eventId}` : null,
    msg.details ? `\n${msg.details}` : null,
    msg.rawJson ? `\nraw: ${truncateText(JSON.stringify(msg.rawJson))}` : null
  ].filter(Boolean);

  return truncateText(lines.join('\n'));
}

async function getGraphToken({ tenantId, clientId, clientSecret }) {
  const endpoint = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: 'https://graph.microsoft.com/.default'
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Graph token request failed: ${response.status} ${errBody}`);
  }

  const tokenJson = await response.json();
  if (!tokenJson.access_token) {
    throw new Error('Graph token request returned no access_token');
  }

  return tokenJson.access_token;
}

function buildSubject(title) {
  const prefix = process.env.SUBJECT_PREFIX || '[Proxmox]';
  const safeTitle = String(title || 'Notification');
  return `${prefix} ${safeTitle}`;
}

function assertEmailPolicy({ senderUpn, recipients, subject, body }) {
  const expectedSender = getEnv('SENDER_UPN').toLowerCase();
  if (senderUpn.toLowerCase() !== expectedSender) {
    throw new Error('Sender mismatch blocked by allow-list policy');
  }

  const allowedRecipients = new Set(getCsv('ALLOWED_RECIPIENTS', true).map((v) => v.toLowerCase()));
  const badRecipients = recipients.filter((r) => !allowedRecipients.has(r.toLowerCase()));
  if (badRecipients.length > 0) {
    throw new Error(`Blocked recipient(s) by allow-list policy: ${badRecipients.join(', ')}`);
  }

  const prefix = process.env.SUBJECT_PREFIX || '[Proxmox]';
  if (!subject.startsWith(prefix)) {
    throw new Error('Subject prefix policy failed');
  }

  if (body.length > MAX_BODY_CHARS) {
    throw new Error('Body exceeds configured maximum');
  }
}

async function sendGraphEmail(message, context) {
  const tenantId = getEnv('TENANT_ID');
  const clientId = getEnv('CLIENT_ID');
  const clientSecret = getEnv('CLIENT_SECRET');
  const senderUpn = getEnv('SENDER_UPN');
  const recipients = getCsv('ALLOWED_RECIPIENTS', true);

  const subject = buildSubject(message.title);
  const body = truncateText(formatTextMessage(message));

  assertEmailPolicy({ senderUpn, recipients, subject, body });

  const token = await getGraphToken({ tenantId, clientId, clientSecret });

  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderUpn)}/sendMail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: {
        subject,
        body: {
          contentType: 'Text',
          content: body
        },
        toRecipients: recipients.map((address) => ({ emailAddress: { address } }))
      },
      saveToSentItems: true
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Graph sendMail failed: ${response.status} ${errBody}`);
  }

  context.log('Email delivered via Graph', { senderUpn, recipientsCount: recipients.length });
}

function validateWebhookTarget(url) {
  const approvedUrls = new Set(getCsv('TEAMS_WEBHOOK_URLS', true));
  if (!approvedUrls.has(url)) {
    throw new Error('Teams webhook URL is not in TEAMS_WEBHOOK_URLS allow-list');
  }

  const allowedHostPatterns = getCsv('TEAMS_ALLOWED_HOST_PATTERNS').length
    ? getCsv('TEAMS_ALLOWED_HOST_PATTERNS')
    : ['*.webhook.office.com', '*.webhook.office365.com', 'outlook.office.com'];

  const parsed = new URL(url);

  const hostOk = allowedHostPatterns.some((pattern) => {
    const p = pattern.toLowerCase();
    const host = parsed.hostname.toLowerCase();
    if (p.startsWith('*.')) {
      return host.endsWith(p.slice(1));
    }
    return host === p;
  });

  if (!hostOk) {
    throw new Error(`Teams webhook hostname blocked by allow-list: ${parsed.hostname}`);
  }
}

async function sendTeamsWebhook(message, context) {
  const webhookUrl = getCsv('TEAMS_WEBHOOK_URLS', true)[0];
  validateWebhookTarget(webhookUrl);

  const text = formatTextMessage(message);
  const payload = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    summary: message.title,
    themeColor: message.severity === 'critical' ? 'FF0000' : '0078D7',
    title: buildSubject(message.title),
    text
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Teams webhook send failed: ${response.status} ${errBody}`);
  }

  context.log('Teams webhook message delivered', { webhookTarget: redactUrl(webhookUrl) });
}

function parseAllowedTargets() {
  return new Set(
    getCsv('ALLOWED_TEAMS_TARGETS', true)
      .map((pair) => pair.trim())
      .filter(Boolean)
  );
}

async function sendTeamsGraph(message, context) {
  const teamId = getEnv('TEAMS_TEAM_ID');
  const channelId = getEnv('TEAMS_CHANNEL_ID');
  const targetKey = `${teamId}:${channelId}`;
  const allowed = parseAllowedTargets();

  if (!allowed.has(targetKey)) {
    throw new Error(`Teams graph target blocked by allow-list: ${targetKey}`);
  }

  const tenantId = process.env.TEAMS_TENANT_ID || getEnv('TENANT_ID');
  const clientId = process.env.TEAMS_CLIENT_ID || getEnv('CLIENT_ID');
  const clientSecret = process.env.TEAMS_CLIENT_SECRET || getEnv('CLIENT_SECRET');

  const token = await getGraphToken({ tenantId, clientId, clientSecret });

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        body: {
          contentType: 'text',
          content: formatTextMessage(message)
        }
      })
    }
  );

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Teams Graph send failed: ${response.status} ${errBody}`);
  }

  context.log('Teams graph message delivered', { targetKey });
}

async function dispatch(message, channels, context) {
  const jobs = channels.map(async (channel) => {
    if (channel === 'email') return sendGraphEmail(message, context);
    if (channel === 'teams') {
      const mode = (process.env.TEAMS_MODE || 'webhook').toLowerCase();
      if (mode === 'graph') return sendTeamsGraph(message, context);
      return sendTeamsWebhook(message, context);
    }
    throw new Error(`Unknown channel: ${channel}`);
  });

  await Promise.all(jobs);
}

app.http('proxmoxWebhook', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'proxmox/webhook',
  handler: async (request, context) => {
    try {
      if (!validateSecretHeader(request)) {
        return { status: 401, jsonBody: { error: 'Unauthorized' } };
      }

      const contentType = request.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('application/json')) {
        return { status: 415, jsonBody: { error: 'Content-Type must be application/json' } };
      }

      let payload;
      try {
        payload = await request.json();
      } catch {
        return { status: 400, jsonBody: { error: 'Invalid JSON payload' } };
      }

      if (!payload || typeof payload !== 'object') {
        return { status: 400, jsonBody: { error: 'Payload must be a JSON object' } };
      }

      const channels = getCsv('CHANNELS', true).map((v) => v.toLowerCase());
      validateChannels(channels);

      const normalized = normalizeProxmoxPayload(payload);
      await dispatch(normalized, channels, context);

      return {
        status: 200,
        jsonBody: {
          ok: true,
          message: 'Webhook accepted and delivered',
          channels
        }
      };
    } catch (error) {
      context.error('Webhook processing error', {
        message: error.message,
        stack: boolFromEnv('DEBUG') ? error.stack : undefined
      });

      if (error.message.startsWith('Missing required environment')) {
        return { status: 500, jsonBody: { error: 'Server misconfiguration' } };
      }

      if (
        error.message.includes('allow-list') ||
        error.message.includes('policy') ||
        error.message.includes('Unsupported channel')
      ) {
        return { status: 400, jsonBody: { error: error.message } };
      }

      return { status: 502, jsonBody: { error: 'Delivery failed' } };
    }
  }
});
