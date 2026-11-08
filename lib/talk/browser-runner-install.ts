/**
 * Starting the browser runner with the computer, and again when it stops
 * (plan #3075). `npm run browser-runner -- pc --install` on the PC writes a
 * script into the Windows Startup folder; `-- mac --install` on the Mac
 * writes a launchd agent. Both run the runner from this checkout, start it
 * at sign-in, and start it again 30 seconds after it exits for any reason,
 * a crash or a lost connection included.
 *
 * Every browser hand-off up to 8 November 2026 found no runner: the setup
 * step asked for one to be started by hand and left running, and none ever
 * sent a heartbeat. This file holds the text of what is written, so the
 * tests read it; scripts/browser-runner.ts writes it and starts it.
 */

/** The Startup-folder script's name on Windows. */
export const WINDOWS_STARTUP_NAME = 'Dash browser runner.cmd';

/** The launchd agent's label, and its file name under ~/Library/LaunchAgents. */
export const MAC_AGENT_LABEL = 'app.dash.browser-runner';

/** Seconds between the runner stopping and starting again. */
export const RESTART_SECONDS = 30;

/** Where Windows keeps the signed-in user's Startup folder, from %APPDATA%. */
export function windowsStartupFolder(appData: string): string {
  return `${appData.replace(/[\\/]+$/, '')}\\Microsoft\\Windows\\Start Menu\\Programs\\Startup`;
}

/**
 * The script Windows runs at sign-in: a titled window that runs the runner
 * from the checkout and starts it again whenever it stops. Closing the
 * window stops it until the next sign-in.
 */
export function windowsStartupScript(repoDir: string, machine: 'pc' | 'mac'): string {
  return [
    '@echo off',
    'rem Written by npm run browser-runner -- pc --install (plan #3075). Delete this file, or run',
    'rem npm run browser-runner -- pc --uninstall, to stop the runner starting with Windows.',
    `title Dash browser runner (${machine === 'pc' ? 'PC' : 'Mac'})`,
    `cd /d "${repoDir}"`,
    ':loop',
    `call npm run browser-runner -- ${machine}`,
    `echo The browser runner stopped. It starts again in ${RESTART_SECONDS} seconds; close this window to stop it.`,
    `timeout /t ${RESTART_SECONDS} /nobreak >nul`,
    'goto loop',
    '',
  ].join('\r\n');
}

function xml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A path quoted for a POSIX shell. */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * The launchd agent: runs the runner from the checkout through a login
 * shell, so node, npm and claude are on its PATH as in Terminal, at sign-in
 * and again RESTART_SECONDS after it exits. What it prints goes to the log.
 */
export function macLaunchAgent(repoDir: string, machine: 'pc' | 'mac', logPath: string): string {
  const command = `cd ${shellQuote(repoDir)} && exec npm run browser-runner -- ${machine}`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${MAC_AGENT_LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    '    <string>/bin/zsh</string>',
    '    <string>-ilc</string>',
    `    <string>${xml(command)}</string>`,
    '  </array>',
    '  <key>WorkingDirectory</key>',
    `  <string>${xml(repoDir)}</string>`,
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>ThrottleInterval</key>',
    `  <integer>${RESTART_SECONDS}</integer>`,
    '  <key>StandardOutPath</key>',
    `  <string>${xml(logPath)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${xml(logPath)}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/** What the runner needs before it starts, as a sentence saying what to set; null when it has it. */
export function missingSetup(env: Readonly<Record<string, string | undefined>>, projectUrl: string | null): string | null {
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return 'SUPABASE_SERVICE_ROLE_KEY is not set. Put SUPABASE_SERVICE_ROLE_KEY=<the service_role key from Supabase, Project settings, API keys> in a file called .env.local in this folder, then start the runner again.';
  }
  if (!projectUrl) {
    return 'No Supabase project is named. Add NEXT_PUBLIC_SUPABASE_URL=https://<project ref>.supabase.co to .env.local in this folder, then start the runner again.';
  }
  return null;
}
