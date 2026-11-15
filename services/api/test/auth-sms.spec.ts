import { TwilioSms } from '../src/auth/auth';

describe('TwilioSms', () => {
  const keys = ['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_MESSAGING_SERVICE_SID','TWILIO_FROM','TWILIO_STATUS_CALLBACK_URL'];
  const original = new Map(keys.map(key => [key, process.env[key]]));
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123456789';
    process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
    process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG123456789';
    delete process.env.TWILIO_FROM;
    delete process.env.TWILIO_STATUS_CALLBACK_URL;
  });
  afterEach(() => {
    for (const key of keys) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends to Egypt in E.164 through a Twilio Messaging Service', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as any;
    await new TwilioSms().send('01000000001', 'Your Fawran code: 000000');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/Accounts/AC123456789/Messages.json');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('AC123456789:test-auth-token').toString('base64')}`);
    const body = new URLSearchParams(init.body);
    expect(body.get('To')).toBe('+201000000001');
    expect(body.get('MessagingServiceSid')).toBe('MG123456789');
    expect(body.has('From')).toBe(false);
  });

  it('does not expose Twilio response bodies or credentials on provider errors', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ code: 30018, message: 'private provider details' }),
    }) as any;
    await expect(new TwilioSms().send('01000000001', 'test')).rejects.toThrow('HTTP 400, code 30018');
  });

  it('requires complete Twilio credentials', async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    await expect(new TwilioSms().send('01000000001', 'test')).rejects.toThrow('not fully configured');
  });
});
