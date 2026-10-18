import type { Divider, Edge, Mat, Opening, OpeningType, Profile, Project } from '../types.ts';
import { projectMat } from './colors.ts';

// Профильные системы по материалу, мм (как в старом проекте):
//   frame — рама, mullion — импост, wSash / dSash — створка окна / двери, bead — штапик,
//   slidFrame / slidSash — раздвижные, lock — Front Locking, panelSlat — ширина планки панели;
//   sashGap — зазор створки от рамы, sashB — вынос створки наружу, slidGap — заход раздвижной под раму,
//   weld — припуск на сварку на конец, glassGap — зазор стекла на сторону.
export const PROFILE_SYSTEMS: Record<Mat, Omit<Profile, 'mat' | 'vis'>> = {
  pvc: { frame:45, mullion:44, wSash:35, dSash:65, bead:20, slidFrame:44, slidSash:50, lock:6, panelSlat:100,
         sashGap:12, sashB:20, slidGap:8, weld:3, glassGap:5 },
  alu: { frame:30, mullion:26, wSash:27, dSash:59, bead:22, slidFrame:42, slidSash:45, lock:6, panelSlat:80,
         sashGap:12, sashB:18, slidGap:9, weld:0, glassGap:5 }
};
// Москитная сетка створчатого окна заходит на раму на столько мм с каждой стороны от проёма створки.
export const NET_OVERLAP = 20;
// Армирование импоста короче детали на столько мм с каждой стороны (у рамы и створок — настройка раскроя).
export const REINF_MULLION_OFFSET = 10;

// профиль с учётом материала проекта (копия, чтобы константу нельзя было испортить)
export function profileFor(project: Project | { type?: Mat } | null | undefined): Profile {
  const mat = projectMat(project as Project);
  return Object.assign({ mat }, PROFILE_SYSTEMS[mat]);
}
// толщина профиля створки: дверь — dSash, раздвижная — slidSash, иначе wSash
export function sashProfile(profile: Profile, opening: Opening | null | undefined): number {
  const t = opening && opening.type;
  if(t === 'Door') return profile.dSash;
  if(t === 'Sliding' || t === 'FixSliding') return profile.slidSash;
  return profile.wSash;
}

// Для ЧЕРТЕЖА большого окна профиль утолщается: рама не тоньше MIN_FRAME_SHARE большей стороны,
// но не больше ~5 % меньшей. Смета, проверки и размеры считаются по настоящему профилю.
const MIN_FRAME_SHARE = 0.02;
export function visualProfile(profile: Profile, W: number, H: number): Profile {
  if(!(W > 0) || !(H > 0)) return profile;
  const kMax = Math.min(6, 0.05 * Math.min(W, H) / profile.frame);
  const k = Math.max(1, Math.min(kMax, MIN_FRAME_SHARE * Math.max(W, H) / profile.frame));
  if(k <= 1.001) return profile;
  const v: Profile = Object.assign({}, profile, { vis:k });
  (['frame', 'mullion', 'wSash', 'dSash', 'bead', 'slidFrame', 'slidSash', 'sashGap', 'sashB'] as const)
    .forEach(f => { v[f] = profile[f] * k; });
  return v;
}

// Створка накладная: выступает НАРУЖУ за ячейку и закрывает край рамы.
//   sashOverhang — выход наружной кромки за ячейку (ПВХ 8, алюминий 6);
//   sashInset    — от границы ячейки внутрь до штапика;
//   sashBand     — видимая полоса створки.
export function sashOverhang(profile: Profile): number { return profile.sashB - profile.sashGap; }
export function sashInset(profile: Profile, opening: Opening | null | undefined): number { return profile.sashGap + sashProfile(profile, opening); }
export function sashBand(profile: Profile, opening: Opening | null | undefined): number { return sashOverhang(profile) + sashInset(profile, opening); }

// Открывания: тег инструмента -> {тип, сторона петель}. Теги те же, что в старом проекте.
export const OPENINGS: Record<string, { type: OpeningType; hinge: Edge }> = {
  TurnLeft:      { type:'Turn',     hinge:'left'   },
  turnRight:     { type:'Turn',     hinge:'right'  },
  tilt:          { type:'Tilt',     hinge:'bottom' },
  tiltTurnLeft:  { type:'TiltTurn', hinge:'left'   },
  tiltTurnRight: { type:'TiltTurn', hinge:'right'  },
  doorLeft:      { type:'Door',     hinge:'left'   },
  doorRight:     { type:'Door',     hinge:'right'  }
};

// --- Раздвижные: заход на соседа у Interlock и под раму, мм ---
export const SLIDING_PROFILE: Record<Mat, { overlap: number; under: number }> = {
  pvc: { overlap:35,   under:8 },
  alu: { overlap:33.5, under:9 }
};
// Разделитель: 'cap' = Interlock (0 мм, створки заходят друг на друга), 'adapter' = Front Locking (6 мм)
export const SLIDING_GAP: Record<Divider, number> = { cap:0, adapter:6 };

// Ячейки слева направо. Sliding.hinge = сторона РУЧКИ.
const SL_L: Opening = { type:'Sliding', hinge:'left' };
const SL_R: Opening = { type:'Sliding', hinge:'right' };
const SL_F: Opening = { type:'FixSliding' };
export const SLIDING_TEMPLATES: Record<string, { cells: Opening[]; dividers: Divider[] }> = {
  sliding_2_a: { cells:[SL_L, SL_F],                 dividers:['cap'] },
  sliding_2_b: { cells:[SL_F, SL_R],                 dividers:['cap'] },
  sliding_2_c: { cells:[SL_L, SL_R],                 dividers:['cap'] },
  sliding_3_a: { cells:[SL_L, SL_F, SL_R],           dividers:['cap', 'cap'] },
  sliding_3_f: { cells:[SL_L, SL_F, SL_F],           dividers:['cap', 'adapter'] },
  sliding_3_g: { cells:[SL_F, SL_F, SL_R],           dividers:['adapter', 'cap'] },
  sliding_3_h: { cells:[SL_F, SL_L, SL_F],           dividers:['adapter', 'cap'] },
  sliding_3_i: { cells:[SL_F, SL_R, SL_F],           dividers:['cap', 'adapter'] },
  sliding_4_a: { cells:[SL_F, SL_R, SL_L, SL_F],     dividers:['cap', 'adapter', 'cap'] },
  sliding_4_b: { cells:[SL_L, SL_R, SL_L, SL_R],     dividers:['cap', 'adapter', 'cap'] }
};
