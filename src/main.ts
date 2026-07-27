/**
 * Entry point.
 *
 * Wires the canvas and the UI root into the app, registers every screen, then
 * hands control to the loop. Anything that can fail at boot fails loudly here
 * rather than leaving a black rectangle on screen.
 */

import './styles/global.css';
import './styles/screens.css';

import { App } from './app/App';
import { HomeScreen } from './ui/screens/HomeScreen';
import { ResultsScreen } from './ui/screens/ResultsScreen';
import { PauseScreen } from './ui/screens/PauseScreen';
import { RosterScreen } from './ui/screens/RosterScreen';
import { BannerScreen } from './ui/screens/BannerScreen';
import { ShopScreen } from './ui/screens/ShopScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { ProfileScreen } from './ui/screens/ProfileScreen';
import { RatesScreen } from './ui/screens/RatesScreen';
import { PullResultScreen } from './ui/screens/PullResultScreen';
import { DailyScreen } from './ui/screens/DailyScreen';
import { HowToPlayScreen } from './ui/screens/HowToPlayScreen';
import { ChallengeScreen } from './ui/screens/ChallengeScreen';
import { QuestsScreen } from './ui/screens/QuestsScreen';
import { ResonanceScreen } from './ui/screens/ResonanceScreen';
import { textures } from './render/TextureStore';
import { THREATS } from './data/threats';
import { GUARDIANS } from './data/guardians';
import { BANNERS } from './data/banners';

/** Read-only game data, exposed for debugging and the screenshot tooling. */
const AEGIS_DATA = { THREATS, GUARDIANS, BANNERS, textures } as const;

function fail(message: string, err?: unknown): never {
  console.error(message, err);
  document.body.innerHTML = `
    <div style="position:fixed;inset:0;display:grid;place-items:center;padding:32px;text-align:center;
                font-family:system-ui,sans-serif;color:#EAF0FF;background:#04050B">
      <div>
        <h1 style="font-size:20px;margin-bottom:10px">AEGIS could not start</h1>
        <p style="color:#93A0BE;font-size:14px;max-width:36ch;line-height:1.5">${message}</p>
      </div>
    </div>`;
  throw new Error(message);
}

async function main(): Promise<void> {
  const canvas = document.getElementById('game');
  const uiRoot = document.getElementById('ui');
  if (!(canvas instanceof HTMLCanvasElement)) fail('The game canvas is missing from the page.');
  if (!(uiRoot instanceof HTMLElement)) fail('The UI container is missing from the page.');

  let app: App;
  try {
    app = new App(canvas, uiRoot);
  } catch (err) {
    fail('This browser does not support the 2D canvas features AEGIS needs.', err);
  }

  app.screens.register(new HomeScreen(app));
  app.screens.register(new ResultsScreen(app));
  app.screens.register(new PauseScreen(app));
  app.screens.register(new RosterScreen(app));
  app.screens.register(new BannerScreen(app));
  app.screens.register(new ShopScreen(app));
  app.screens.register(new SettingsScreen(app));
  app.screens.register(new ProfileScreen(app));
  app.screens.register(new RatesScreen(app));
  app.screens.register(new PullResultScreen(app));
  app.screens.register(new DailyScreen(app));
  app.screens.register(new HowToPlayScreen(app));
  app.screens.register(new ChallengeScreen(app));
  app.screens.register(new QuestsScreen(app));
  app.screens.register(new ResonanceScreen(app));

  // Hardware/browser back and Escape both mean "up one level".
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (app.screens.handleBack()) e.preventDefault();
    }
  });

  // One delegated listener gives every control a click sound. Wiring audio into
  // each button individually would mean never forgetting one, forever.
  uiRoot.addEventListener(
    'pointerdown',
    (e) => {
      const target = (e.target as HTMLElement | null)?.closest(
        '.btn, .navbtn, .chipbtn, .gcard, .banner__tab, .segmented__btn, .switch, .levelchip, .hero__frame',
      );
      if (!target) return;
      if (target.classList.contains('is-disabled') || (target as HTMLButtonElement).disabled) {
        app.audio.uiDenied();
        return;
      }
      if (target.classList.contains('btn--primary')) app.audio.uiConfirm();
      else if (target.classList.contains('topbar__back')) app.audio.uiBack();
      else app.audio.uiTap();
    },
    { passive: true },
  );

  await app.boot();
  // A shared link lands on the challenge, not the home screen: the fastest path
  // from "someone sent me this" to "I am playing" is one tap.
  app.showMenu(app.pendingChallenge ? 'challenge' : 'home');

  // Expose for debugging and for the capture tooling, without shipping a dev
  // overlay into the UI.
  (window as unknown as { aegis: App; aegisData: typeof AEGIS_DATA }).aegis = app;
  (window as unknown as { aegisData: typeof AEGIS_DATA }).aegisData = AEGIS_DATA;

  // If a second tab takes over the account, say so once, plainly, where the
  // player is looking — a tab that has quietly stopped saving is worse than one
  // that admits it.
  app.profile.events.on('displaced', () => {
    const notice = document.createElement('div');
    notice.className = 'displaced';
    notice.setAttribute('role', 'status');
    notice.textContent = 'This game is open in another tab, which now owns your progress. Reload to continue here.';
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'btn btn--primary';
    reload.textContent = 'RELOAD';
    reload.addEventListener('click', () => location.reload());
    notice.appendChild(reload);
    document.body.appendChild(notice);
  });

  registerServiceWorker();
}

/**
 * Offline support and install-to-home-screen.
 *
 * Registered after boot so it never competes with the first frame for
 * bandwidth, and skipped in dev where a cached shell only gets in the way.
 */
function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch((err) => {
      console.info('[PWA] service worker not registered', err);
    });
  });
}

void main();
