export const ROLE = { ADMIN: 'ADMIN', ANALISTA: 'ANALISTA', VIEWER: 'VIEWER', GUEST: 'GUEST' };
export const ROLE_LABEL = { ADMIN: 'Administrador', ANALISTA: 'Analista ambiental', VIEWER: 'Visualizador operativo', GUEST: 'Invitado' };
export const SEVERITY = ['Óptimo', 'Precaución', 'Deficiente', 'Malo', 'Crítico'];
export const VALIDITY = { completo: 'Completo', parcial: 'Parcial', dato_insuficiente: 'Dato insuficiente' };
export const COLORS = ['#087e61', '#9c650c', '#b95922', '#b33a3a', '#713c80'];
export const MATRIX = [
  ['O','A1','A2','A3','A4'], ['T1','M1','M2','M3','M4'], ['T2','M2','M2','M3','M4'],
  ['T3','M3','M3','M3','M4'], ['T4','M4','M4','M4','M4']
];
export function severityLabel(score, state) {
  if (!state || state === 'dato_insuficiente' || score == null) return VALIDITY.dato_insuficiente;
  return `${score} · ${SEVERITY[score] || 'Sin clasificar'}`;
}
export function isNewer(incoming, current) {
  const a = Date.parse(incoming || ''); const b = Date.parse(current || '');
  return Number.isFinite(a) && (!Number.isFinite(b) || a > b);
}
export function formatDate(value, options={}) {
  if (!value) return 'Sin ventana verificable';
  const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('es-CL', options).format(date);
}
export function number(value, digits=1) { return value == null ? '—' : new Intl.NumberFormat('es-CL',{maximumFractionDigits:digits}).format(value); }
export const canAnalyze = user => ['ADMIN','ANALISTA'].includes(user?.rol);
export const canAdmin = user => user?.rol === 'ADMIN';
