import React from 'react';
import { FileUp, Moon, Sun } from 'lucide-react';
import { getTranslations, type Language } from '../../utils/i18n';

interface PublicStudio3DHeaderProps {
  theme: 'light' | 'dark';
  lang: Language;
  onToggleTheme: () => void;
  onChangeLang: (lang: Language) => void;
  onTriggerUpload: () => void;
}

export const PublicStudio3DHeader: React.FC<PublicStudio3DHeaderProps> = ({
  theme,
  lang,
  onToggleTheme,
  onChangeLang,
  onTriggerUpload,
}) => {
  const dict = getTranslations(lang);
  const toolbarT = dict.toolbar;

  return (
    <header
      data-testid="public-3d-header"
      className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800"
    >
      <div className="max-w-[1380px] mx-auto px-3 sm:px-5 h-12 flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 font-display text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
          <span className="w-6 h-6 rounded-md bg-blue-600 text-white inline-flex items-center justify-center text-[11px] font-extrabold shrink-0">
            3D
          </span>
          <span>Sport Byte</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            data-testid="header-upload-gpx-btn"
            onClick={onTriggerUpload}
            className="h-8 px-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            <FileUp className="w-3.5 h-3.5" aria-hidden="true" />
            <span>GPX / FIT</span>
          </button>

          <div
            role="group"
            aria-label={dict.nav.languageLabel}
            data-testid="public-3d-lang"
            className="inline-flex items-center p-0.5 h-8 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
          >
            <button
              type="button"
              onClick={() => onChangeLang('en')}
              aria-pressed={lang === 'en'}
              className={`px-1.5 py-0.5 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                lang === 'en'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => onChangeLang('id')}
              aria-pressed={lang === 'id'}
              className={`px-1.5 py-0.5 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                lang === 'id'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              ID
            </button>
          </div>

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? toolbarT.lightMode : toolbarT.darkMode}
            data-testid="public-3d-theme"
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0 cursor-pointer"
          >
            {theme === 'dark' ? (
              <Sun className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
            ) : (
              <Moon className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
