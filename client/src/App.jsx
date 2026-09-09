import React, { useEffect, useState } from 'react';
import { I18nProvider, useI18n } from './i18n.jsx';
import SyncStatus from './components/SyncStatus.jsx';
import Home from './pages/Home.jsx';
import ImportWizard from './pages/ImportWizard.jsx';
import Students from './pages/Students.jsx';
import GradeEntry from './pages/GradeEntry.jsx';
import Behavior from './pages/Behavior.jsx';
import Attendance from './pages/Attendance.jsx';
import Analytics from './pages/Analytics.jsx';
import Reports from './pages/Reports.jsx';
import Submit from './pages/Submit.jsx';

function useHashRoute() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || '/entry');
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash.slice(1) || '/entry');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

const ROUTES = [
  { path: '/entry', key: 'entryNav', icon: '✎', Comp: GradeEntry },
  { path: '/behavior', key: 'behaviorNav', icon: '⚑', Comp: Behavior },
  { path: '/attendance', key: 'attendanceNav', icon: '✓', Comp: Attendance },
  { path: '/analytics', key: 'analyticsNav', icon: '▤', Comp: Analytics },
  { path: '/reports', key: 'reportsNav', icon: '✉', Comp: Reports },
  { path: '/submit', key: 'submitNav', icon: '⇪', Comp: Submit },
  { path: '/import', key: 'import', icon: '⇩', Comp: ImportWizard },
  { path: '/students', key: 'students', icon: '☰', Comp: Students },
  { path: '/', key: 'home', icon: '⌂', Comp: Home },
];

function Shell() {
  const { t, lang, setLang } = useI18n();
  const route = useHashRoute();
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');

  useEffect(() => {
    localStorage.setItem('theme', theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const base = '/' + (route.split('?')[0].split('/')[1] || '');
  const match = ROUTES.find(r => r.path === base) || ROUTES[ROUTES.length - 1];
  const Page = match.Comp;

  return (
    <>
      <header className="topbar no-print">
        <h1>{t('appName')}</h1>
        <SyncStatus />
        <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} title={t('theme')}>
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
        <button onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
          {lang === 'ar' ? 'EN' : 'ع'}
        </button>
      </header>
      <nav className="nav no-print">
        {ROUTES.map(r => (
          <a key={r.path} href={`#${r.path}`} className={base === r.path ? 'active' : ''}>
            <span className="ico">{r.icon}</span>{t(r.key)}
          </a>
        ))}
      </nav>
      <main><Page /></main>
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
