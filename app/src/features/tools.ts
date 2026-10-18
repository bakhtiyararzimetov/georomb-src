// Инструменты панели редактора (теги — как в старом проекте). Иконки 24×24.
export interface Tool { tag: string; title: string; icon: string; }

export const TOOLS: Tool[] = [
  { tag:'MV1',  title:'Вертикальный импост',
    icon:'<path d="M12 4v16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  { tag:'MH',   title:'Горизонтальный импост',
    icon:'<path d="M4 12h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  { tag:'turnRight', title:'Поворотное, петли справа',
    icon:'<rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M20.5 4.5 L3.5 12 L20.5 19.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="5.6" cy="12" r="1.1" fill="currentColor"/>' },
  { tag:'tiltTurnRight', title:'Поворотно-откидное, петли справа',
    icon:'<rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M20.5 4.5 L3.5 12 L20.5 19.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M3.5 19.5 L12 4.5 L20.5 19.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-dasharray="1.6 1.4" stroke-linejoin="round"/><circle cx="5.6" cy="12" r="1.1" fill="currentColor"/>' },
  { tag:'doorRight', title:'Дверь, петли справа',
    icon:'<rect x="5.5" y="2.5" width="13" height="19" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M18.5 2.5 L5.5 12 L18.5 21.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="7.6" cy="12" r="1.1" fill="currentColor"/>' },
  { tag:'horizontalPanel', title:'Панель с горизонтальными полосами',
    icon:'<rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 7.5h17M3.5 10.5h17M3.5 13.5h17M3.5 16.5h17" stroke="currentColor" stroke-width="1.3"/>' },

  { tag:'MV2',  title:'Два вертикальных импоста',
    icon:'<path d="M9 4v16M15 4v16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  { tag:'tilt', title:'Нижнеподвесное (откидное)',
    icon:'<rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 19.5 L12 4.5 L20.5 19.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="12" cy="7" r="1.1" fill="currentColor"/>' },
  { tag:'TurnLeft', title:'Поворотное, петли слева',
    icon:'<rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 4.5 L20.5 12 L3.5 19.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="18.4" cy="12" r="1.1" fill="currentColor"/>' },
  { tag:'tiltTurnLeft', title:'Поворотно-откидное, петли слева',
    icon:'<rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 4.5 L20.5 12 L3.5 19.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M3.5 19.5 L12 4.5 L20.5 19.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-dasharray="1.6 1.4" stroke-linejoin="round"/><circle cx="18.4" cy="12" r="1.1" fill="currentColor"/>' },
  { tag:'doorLeft', title:'Дверь, петли слева',
    icon:'<rect x="5.5" y="2.5" width="13" height="19" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 2.5 L18.5 12 L5.5 21.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="16.4" cy="12" r="1.1" fill="currentColor"/>' },
  { tag:'verticalPanel', title:'Панель с вертикальными полосами',
    icon:'<rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M6.9 4.5v15M10.3 4.5v15M13.7 4.5v15M17.1 4.5v15" stroke="currentColor" stroke-width="1.3"/>' }
];
