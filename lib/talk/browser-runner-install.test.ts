import { describe, expect, it } from 'vitest';
import {
  MAC_AGENT_LABEL,
  macLaunchAgent,
  missingSetup,
  shellQuote,
  windowsStartupFolder,
  windowsStartupScript,
} from './browser-runner-install';

describe('starting the browser runner with the computer (plan #3075)', () => {
  it('writes a Windows Startup script that runs the PC runner from the checkout and starts it again when it stops', () => {
    const script = windowsStartupScript('C:\\Users\\me\\PersonalDashboard', 'pc');
    expect(script).toContain('cd /d "C:\\Users\\me\\PersonalDashboard"');
    expect(script).toContain('call npm run browser-runner -- pc');
    expect(script).toMatch(/:loop[\s\S]*timeout \/t 30[\s\S]*goto loop/);
    expect(script.split('\r\n').length).toBeGreaterThan(5);
  });

  it('finds the Startup folder under APPDATA', () => {
    expect(windowsStartupFolder('C:\\Users\\me\\AppData\\Roaming\\')).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup',
    );
  });

  it('writes a launchd agent that starts at sign-in, stays alive and runs through a login shell', () => {
    const plist = macLaunchAgent("/Users/me/Dash & Co's", 'mac', '/Users/me/Library/Logs/dash-browser-runner.log');
    expect(plist).toContain(`<string>${MAC_AGENT_LABEL}</string>`);
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
    expect(plist).toContain('<string>-ilc</string>');
    // The path is shell-quoted, then XML-escaped.
    expect(plist).toContain("cd '/Users/me/Dash &amp; Co'\\''s' &amp;&amp; exec npm run browser-runner -- mac");
    expect(plist).toContain("<string>/Users/me/Dash &amp; Co's</string>");
  });

  it('quotes a path for the shell', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it('says what to set when the key or the project is missing', () => {
    expect(missingSetup({}, 'https://x.supabase.co')).toContain('.env.local');
    expect(missingSetup({ SUPABASE_SERVICE_ROLE_KEY: 'k' }, null)).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(missingSetup({ SUPABASE_SERVICE_ROLE_KEY: 'k' }, 'https://x.supabase.co')).toBeNull();
  });
});
