// Shared by the installed userscript's help menu and its generated source guide.
export const TROUBLESHOOTING_GUIDE = `DigDig Tools — help / troubleshooting

Brave / Chrome: installed, but nothing happens?
1. Open brave://extensions (or chrome://extensions).
2. Open Tampermonkey → Details and turn on “Allow User Scripts”.
   This permission can be disabled by default, even when the script is installed
   and enabled. The help menu cannot appear until userscripts are allowed to run.
3. Reload the game page.

Connect to the desktop app
• Keep DigDig Map Observatory open while playing.
• Install the paired script from the app's hamburger menu → Install userscript.
• If you installed the generic deploy/digdig.user.js file, open the game and use
  Tampermonkey → “DigDig: Pair with desktop”. Install its replacement, then reload.
• Allow Tampermonkey to connect to 127.0.0.1 if prompted.
• Enable only one DigDig userscript at a time. Disable the development script when
  using the desktop release script.

Connected, but waiting for game WASM?
In Brave / Chrome, try Tampermonkey Settings → Content Script API →
“UserScripts API Dynamic”, if available, then reload the game. This lets capture
start before the game loads. The plain “UserScripts API” mode behaves differently
on Chromium and Firefox.

After installing or changing permissions, reload the game page once.
This guide is also available in the app's Userscript panel and at the top of the
script source, including when the browser prevents the script from running.
The script observes the original game; it never modifies game WASM instructions.`;

export function showTroubleshooting() {
  window.alert(TROUBLESHOOTING_GUIDE);
}
