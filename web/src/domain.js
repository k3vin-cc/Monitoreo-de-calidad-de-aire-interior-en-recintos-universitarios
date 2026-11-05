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
/** Nombre: nodePresence. Razón: evita confundir el último estado guardado con señal reciente.
 * Entradas: fecha de última telemetría verificable y hora actual en milisegundos.
 * Salida: reciente, sin_senal o sin_datos. Efectos: ninguno. */
export function nodePresence(lastTelemetry, now=Date.now()) {
  if (!lastTelemetry) return 'sin_datos';
  const timestamp=Date.parse(lastTelemetry);
  if (!Number.isFinite(timestamp) || timestamp>now+120000) return 'sin_datos';
  return now-timestamp<12*60000 ? 'reciente' : 'sin_senal';
}
/** Nombre: hasRecentRoomData. Razón: impide presentar una ventana histórica como condición actual.
 * Entradas: estado de sala de la API y hora actual en milisegundos.
 * Salida: verdadero sólo si el nodo asignado y la ventana verificable tienen datos recientes. Efectos: ninguno. */
export function hasRecentRoomData(state, now=Date.now()) {
  return Boolean(state?.nodoId && nodePresence(state.ultimaTelemetria,now)==='reciente' && nodePresence(state.ventanaTimestamp,now)==='reciente');
}
export const NODE_CONNECTION_LABELS = {
  conectado: 'Conectado',
  no_respondio: 'No respondió',
  desconectado: 'Desconectado',
  presencia_no_disponible: 'Presencia no disponible'
};
export const NODE_CONNECTION_BADGES = {
  conectado: 'good',
  no_respondio: 'caution',
  desconectado: 'muted',
  presencia_no_disponible: 'muted'
};
/** Nombre: nodeConnectionState. Razón: separa la presencia del nodo de la antigüedad de sus mediciones.
 * Entradas: nodo recibido desde la API, con estado y última señal periódica.
 * Salida: estado de presencia permitido o presencia_no_disponible. Efectos: ninguno. */
export function nodeConnectionState(node) {
  if (!node?.ultimaSenalPresencia) return 'presencia_no_disponible';
  return ['conectado', 'no_respondio', 'desconectado'].includes(node.estado)
    ? node.estado
    : 'presencia_no_disponible';
}
