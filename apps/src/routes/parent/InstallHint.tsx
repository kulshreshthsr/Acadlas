// A small card offering to put the parent app on the home screen, so it opens like any
// other app. Shown once per phone until dismissed or installed.
import { useState } from 'react';
import { isIOS, isInstalled, useInstallPrompt } from '../../lib/install';
import { Icon } from '../../components/Icon';

const DISMISSED = 'acadlas.install-hint.dismissed';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
}

export function InstallHint() {
  const { ready, install } = useInstallPrompt();
  const [hidden, setHidden] = useState(() => wasDismissed() || isInstalled());
  const ios = isIOS();

  if (hidden || (!ready && !ios)) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {
      // Private browsing: it simply shows again next time.
    }
    setHidden(true);
  };

  return (
    <div className="no-print wrap max-w-3xl pt-4">
      <div className="flex items-start gap-3 rounded-2xl bg-white p-3.5 shadow-soft ring-1 ring-slate-200">
        <img src="/favicon-192x192.png" alt="" width={40} height={40} className="shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.9375rem] font-semibold text-ink-800">Add Acadlas to your home screen</p>
          {ios ? (
            <p className="mt-0.5 text-[0.8125rem] leading-snug text-slate-500">
              In Safari, tap <b>Share</b> <Icon name="upload" size={13} className="inline align-[-2px]" /> then <b>Add to Home Screen</b>.
            </p>
          ) : (
            <p className="mt-0.5 text-[0.8125rem] leading-snug text-slate-500">It opens like an app. Nothing about your child is stored on the phone.</p>
          )}
          {!ios && (
            <button
              type="button"
              className="btn btn-ink btn-sm mt-2.5"
              onClick={async () => {
                if (await install()) setHidden(true);
              }}
            >
              Add to home screen
            </button>
          )}
        </div>
        <button type="button" className="btn btn-quiet btn-icon -mr-1 -mt-1" aria-label="Not now" onClick={dismiss}>
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}
