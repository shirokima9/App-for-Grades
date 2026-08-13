import React, { useEffect, useState } from 'react';
import { I18nProvider, useI18n } from './i18n.jsx';
import Home from './pages/Home.jsx';
import ImportWizard from './pages/ImportWizard.jsx';
import Students from './pages/Students.jsx';

function useHashRoute() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || '/');
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

function Shell() {
  const { t, lang, setLang } = useI18n();
  const route = useHashRoute();
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  useEffect(() => {
    localStorage.setItem('theme', theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const pages = [
    { path: '/', label: t('home') },
    { path: '/import', label: t('import') },
    { path: '/students', label: t('students') },
  ];

  let page = <Home />;
  if (route.startsWith('/import')) page = <ImportWizard />;
  else if (route.startsWith('/students')) page = <Students />;

  return (
    <>
      <header className="topbar">
        <h1>{t('appName')}</h1>
        <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
          {theme === 'light' ? '🌙 ' + t('darkMode') : '☀️ ' + t('lightMode')}
        </button>
        <button onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
          {lang === 'ar' ? 'EN' : 'ع'}
        </button>
      </header>
      <nav className="nav">
        {pages.map(p => (
          <a key={p.path} href={`#${p.path}`} className={route === p.path ? 'active' : ''}>
            {p.label}
          </a>
        ))}
      </nav>
      <main>{page}</main>
    </>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <Shell />
    </I18nProvider>
  );
}
