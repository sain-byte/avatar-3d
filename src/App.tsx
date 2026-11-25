import React, { useCallback, useEffect, useState } from 'react';
import { Studio3DView } from './components/studio3d/Studio3DView';
import { PublicStudio3DHeader } from './components/studio3d/PublicStudio3DHeader';
import type { Language } from './utils/i18n';
import type { RunLog } from './types';

function getInitialTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem('sportbyte3d_theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getInitialLang(): Language {
  if (typeof window === 'undefined') return 'id';
  const stored = window.localStorage.getItem('sportbyte3d_lang');
  if (stored === 'en' || stored === 'id') return stored;
  return 'id';
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);
  const [lang, setLang] = useState<Language>(getInitialLang);
  const [runs] = useState<RunLog[]>([]);
  const [uploadTick, setUploadTick] = useState(0);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    window.localStorage.setItem('sportbyte3d_theme', theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem('sportbyte3d_lang', lang);
  }, [lang]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const changeLang = useCallback((next: Language) => {
    setLang(next);
  }, []);

  const triggerUpload = useCallback(() => {
    setUploadTick((n) => n + 1);
  }, []);

  return (
    <div className="studio3d-root bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <PublicStudio3DHeader
        theme={theme}
        lang={lang}
        onToggleTheme={toggleTheme}
        onChangeLang={changeLang}
        onTriggerUpload={triggerUpload}
      />
      <main className="flex-1 flex flex-col min-h-0">
        <Studio3DView
          runs={runs}
          lang={lang}
          isGuest={true}
          externalUploadTrigger={uploadTick}
        />
      </main>
    </div>
  );
}
