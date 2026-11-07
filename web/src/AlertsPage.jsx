import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, live } from './services';
import { formatDate, hasRecentRoomData, number } from './domain';
import HistoryRoomPicker from './HistoryRoomPicker';
import HistoryDateDialog from './HistoryDateDialog';

const units = { CO2: 'ppm', 'PM2.5': 'µg/m³', PM10: 'µg/m³', Temperatura: '°C', Humedad: '%' };
const dateOptions = { dateStyle: 'short', timeStyle: 'short' };
const initialFilters = { salaId: '', sectorId: '', edificioId: '', pisoId: '', nodoId: '', estado: '', variable: '', nivel: '', orden: 'fecha', periodo: 'todos', desde: '', hasta: '' };

/** Nombre: localDate. Razón: preparar fechas para el calendario local. Entradas: fecha.
 * Salida: cadena local de minutos. Efectos: ninguno. */
function localDate(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Nombre: duration. Razón: explicar el orden por duración. Entradas: alerta y hora de corte.
 * Salida: días, horas y minutos transcurridos. Efectos: ninguno. */
function duration(alert, cutoff) {
  const minutes = Math.max(0, Math.floor((Date.parse(alert.resueltaEn || cutoff) - Date.parse(alert.ventanaConfirmacion)) / 60000));
  if (!Number.isFinite(minutes)) return '—';
  return `${Math.floor(minutes / 1440)} d ${Math.floor(minutes % 1440 / 60)} h ${minutes % 60} min`;
}

/** Nombre: queryFilters. Razón: convertir períodos y filtros a parámetros de la API.
 * Entradas: filtros elegidos y hora de consulta. Salida: parámetros explícitos. Efectos: ninguno. */
function queryFilters(filters, now = new Date()) {
  const { periodo, desde, hasta, ...params } = filters;
  if (periodo === 'custom') return { ...params, desde: new Date(desde).toISOString(), hasta: new Date(new Date(hasta).getTime() + 59999).toISOString() };
  if (periodo === 'todos') return params;
  const start = new Date(now);
  if (periodo === 'hoy') start.setHours(0, 0, 0, 0);
  else start.setTime(now.getTime() - (periodo === '24h' ? 1 : 7) * 86400000);
  return { ...params, desde: start.toISOString(), hasta: now.toISOString() };
}

/** Nombre: OriginNodePicker. Razón: elegir un nodo de origen sin acceso administrativo a nodos.
 * Entradas: nodo seleccionado y callback. Salida: búsqueda accesible. Efectos: consultas y estado local. */
function OriginNodePicker({ value, onChange }) {
  const [query, setQuery] = useState(''), [open, setOpen] = useState(false), [rows, setRows] = useState([]);
  const [active, setActive] = useState(-1), [status, setStatus] = useState('idle');
  const root = useRef(null), id = useId();
  useEffect(() => {
    if (!open || query.trim().length < 2) { setRows([]); setStatus('idle'); return; }
    let current = true;
    setStatus('loading'); setRows([]);
    const timer = setTimeout(() => api.alertNodes(query.trim()).then(data => {
      if (current) { setRows(data); setStatus('ready'); }
    }).catch(() => { if (current) { setRows([]); setStatus('error'); } }), 300);
    return () => { current = false; clearTimeout(timer); };
  }, [query, open]);
  /** Nombre: choose. Razón: aplicar un nodo de origen. Entradas: nodo autorizado.
   * Salida: filtro actualizado. Efectos: actualiza estado local. */
  function choose(row) { onChange(row); setQuery(''); setRows([]); setOpen(false); setActive(-1); }
  return <div className="alertOrigin" ref={root} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
    <label htmlFor={id}>Nodo de origen</label>
    <input id={id} role="combobox" aria-expanded={open} aria-controls={id + '-list'} aria-autocomplete="list" aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
      value={open ? query : value?.nombre || ''} placeholder="Buscar nodo de origen…" autoComplete="off"
      onFocus={() => { setQuery(''); setOpen(true); setActive(-1); }} onChange={e => { setQuery(e.target.value); setOpen(true); setActive(-1); }}
      onKeyDown={e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive(i => e.key === 'ArrowDown' ? Math.min(i + 1, rows.length - 1) : Math.max(i - 1, 0)); }
        if (e.key === 'Enter' && open) { e.preventDefault(); if (rows[active >= 0 ? active : 0]) choose(rows[active >= 0 ? active : 0]); }
        if (e.key === 'Escape') { setOpen(false); setActive(-1); }
      }} />
    {value && <button type="button" className="textButton" onClick={() => choose(null)}>Quitar nodo</button>}
    <small>Filtra por el nodo que originó la alerta.</small>
    {open && <div className="historyRoomOptions"><ul id={id + '-list'} role="listbox" aria-label="Nodos con alertas">{rows.map((row, i) => <li role="option" aria-selected={value?.id === row.id} id={`${id}-${i}`} className={active === i ? 'active' : ''} key={row.id} onMouseDown={e => e.preventDefault()} onClick={() => choose(row)}><b>{row.nombre || row.id}</b><small>{row.id}</small></li>)}</ul>
      {status === 'loading' && <p role="status">Buscando…</p>}{status === 'error' && <p role="alert">No se pudo buscar el nodo. Vuelve a escribir para reintentar.</p>}{status === 'ready' && !rows.length && <p>No se encontraron nodos.</p>}{rows.length === 30 && <p>Se muestran los primeros 30 resultados; escribe más para acotar.</p>}</div>}
  </div>;
}

/** Nombre: AlertsPage. Razón: consultar alertas autorizadas y facilitar su auditoría.
 * Entradas: sesión y eventos de salas. Salida: filtros, resultados y exportaciones.
 * Efectos: lecturas de API, descargas y estado local. */
export default function AlertsPage() {
  const [filters, setFilters] = useState(() => ({ ...initialFilters, corte: new Date().toISOString() })), [page, setPage] = useState(1);
  const [rooms, setRooms] = useState([]), [roomsError, setRoomsError] = useState(''), [roomsLoading, setRoomsLoading] = useState(true);
  const [node, setNode] = useState(null), [pickerKey, setPickerKey] = useState(0);
  const [result, setResult] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(true);
  const [dialog, setDialog] = useState(false), [downloading, setDownloading] = useState(''), [now, setNow] = useState(Date.now());
  const request = useRef(0), refreshTimer = useRef(null), visibleRooms = useRef(new Set()), downloadLock = useRef(false);
  useEffect(() => {
    let active = true;
    api.rooms({}).then(data => { if (active) setRooms(data); }).catch(e => { if (active) setRoomsError(e.message); }).finally(() => { if (active) setRoomsLoading(false); });
    return () => { active = false; };
  }, []);
  /** Nombre: refresh. Razón: consultar sin mostrar respuestas antiguas. Entradas: filtros y página.
   * Salida: resultados o error. Efectos: lectura de API y estado local. */
  const refresh = useCallback(async () => {
    const revision = ++request.current;
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await api.alertsPage({ ...queryFilters(filters), pagina: page });
      if (revision === request.current) { setResult(response); visibleRooms.current = new Set(response.alertas.map(a => a.salaId)); }
    } catch (e) { if (revision === request.current) setError(e.message); }
    finally { if (revision === request.current) setBusy(false); }
  }, [filters, page]);
  useEffect(() => { const timer = setTimeout(refresh, 250); return () => { clearTimeout(timer); request.current++; }; }, [refresh]);
  useEffect(() => {
    const schedule = () => { clearTimeout(refreshTimer.current); refreshTimer.current = setTimeout(refresh, 1200); };
    const offEvent = live.subscribe(event => { if (event.tipo === 'alerta' || (event.tipo === 'ventana' && visibleRooms.current.has(event.salaId))) schedule(); });
    let previous = live.status;
    const offStatus = live.subscribeStatus(status => { if (status === 'connected' && previous !== 'connected') schedule(); previous = status; });
    return () => { offEvent(); offStatus(); clearTimeout(refreshTimer.current); };
  }, [refresh]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  /** Nombre: update. Razón: aplicar filtros y volver a la primera página. Entradas: valores nuevos.
   * Salida: filtros actualizados. Efectos: estado local. */
  function update(changes) { request.current++; setBusy(true); setResult(null); setPage(1); setFilters(current => ({ ...current, ...changes, corte: new Date().toISOString() })); }
  /** Nombre: changePage. Razón: no atribuir los resultados anteriores a la nueva página.
   * Entradas: número de página. Salida: página solicitada. Efectos: actualiza estado local. */
  function changePage(next) { request.current++; setBusy(true); setResult(null); setPage(next); }
  /** Nombre: download. Razón: exportar el conjunto filtrado completo. Entradas: formato CSV o JSON.
   * Salida: descarga o error visible. Efectos: consulta la API y crea una descarga temporal. */
  async function download(format) {
    if (downloadLock.current) return;
    downloadLock.current = true; setDownloading(format); setError('');
    try {
      const blob = await api.exportAlerts(format, queryFilters(filters));
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `alertas.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e.message); } finally { downloadLock.current = false; setDownloading(''); }
  }
  const end = new Date(), start = new Date(end.getTime() - 86400000);
  return <div className="alertsPage">
    <div className="pageHeading"><div><span className="eyebrow">OPERACIÓN / 08</span><h1>Registro de alertas</h1><p>Consulta y exporta alertas confirmadas para auditoría.</p></div><button type="button" className="secondary" onClick={refresh} disabled={busy}>Actualizar</button></div>
    <section className="panel alertSearch"><h2>Filtros</h2>
      {roomsError && <p className="notice error" role="alert">No se pudieron cargar las ubicaciones: {roomsError}</p>}
      <HistoryRoomPicker key={pickerKey} rooms={rooms} value={filters.salaId} disabled={roomsLoading || !!roomsError} context="alertas"
        onChange={(id, room) => update(room ? { salaId: id, sectorId: room.sectorId, edificioId: room.edificioId, pisoId: room.pisoId } : { salaId: '' })}
        onScopeChange={scope => update({ ...scope, salaId: '' })} />
      <div className="alertSearchGrid alertMoreFilters">
        <OriginNodePicker value={node} onChange={row => { setNode(row); update({ nodoId: row?.id || '' }); }} />
        <label>Estado<select value={filters.estado} onChange={e => update({ estado: e.target.value })}><option value="">Todos</option><option value="activa">Activa</option><option value="resuelta">Resuelta</option></select></label>
        <label>Variable<select value={filters.variable} onChange={e => update({ variable: e.target.value })}><option value="">Todas</option>{Object.keys(units).map(key => <option key={key} value={key}>{key === 'CO2' ? 'CO₂' : key}</option>)}</select></label>
        <label>Nivel<select value={filters.nivel} onChange={e => update({ nivel: e.target.value })}><option value="">Todos</option><option value="3">Nivel 3</option><option value="4">Nivel 4</option></select></label>
        <label>Período<select value={filters.periodo} onChange={e => { if (e.target.value === 'custom') setDialog(true); else update({ periodo: e.target.value }); }}><option value="todos">Todos</option><option value="hoy">Hoy</option><option value="24h">Últimas 24 horas</option><option value="7d">Últimos 7 días</option><option value="custom">Personalizado…</option></select></label>
        <label>Orden<select value={filters.orden} onChange={e => update({ orden: e.target.value })}><option value="fecha">Más recientes</option><option value="nivel">Mayor nivel</option><option value="duracion">Mayor duración</option></select></label>
      </div>
      {filters.periodo === 'custom' && <p className="helper">Desde {formatDate(new Date(filters.desde), dateOptions)} hasta {formatDate(new Date(filters.hasta), dateOptions)} <button type="button" className="textButton" onClick={() => setDialog(true)}>Cambiar</button></p>}
      <div className="alertActions"><button type="button" className="secondary" onClick={() => { setNode(null); setPickerKey(n => n + 1); update(initialFilters); }}>Limpiar filtros</button></div>
    </section>
    {dialog && <HistoryDateDialog from={filters.desde || localDate(start)} to={filters.hasta || localDate(end)} onCancel={() => setDialog(false)} onApply={(desde, hasta) => { setDialog(false); update({ periodo: 'custom', desde, hasta }); }} />}
    <p className="helper">Fechas en la zona horaria de tu navegador ({Intl.DateTimeFormat().resolvedOptions().timeZone}). La medición y el nivel corresponden a la ventana de confirmación. Una alerta abierta no garantiza datos recientes.</p>
    <div className="alertActions"><button type="button" className="secondary" disabled={!!downloading} onClick={() => download('csv')}>{downloading === 'csv' ? 'Exportando…' : 'Exportar CSV'}</button><button type="button" className="secondary" disabled={!!downloading} onClick={() => download('json')}>{downloading === 'json' ? 'Exportando…' : 'Exportar JSON'}</button></div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {busy ? <p role="status">Cargando alertas…</p> : result && <section className="panel alertResults"><div className="panelHead"><h2>Alertas</h2><span>Página {page} · {result.alertas.length} resultados{result.hayMas ? ' · hay más resultados' : ''}</span></div>
      {!result.alertas.length ? <p>No hay alertas para los filtros aplicados.</p> : <div className="alertList">{result.alertas.map(a => {
        const recent = hasRecentRoomData({ nodoId: a.nodoActualId, ultimaTelemetria: a.ultimaTelemetria, ventanaTimestamp: a.ventanaTimestamp }, now);
        return <article className="alertItem" key={a.id}><div className="alertItemHead"><div><Link to={'/salas/' + encodeURIComponent(a.salaId)}><b>{a.salaNombre}</b></Link><small>{[a.sectorNombre, a.edificioNombre, a.pisoNombre].filter(Boolean).join(' › ')}</small></div><span className={'badge ' + (a.estado === 'activa' ? 'bad' : 'good')}>{a.estado === 'activa' ? 'Activa' : 'Resuelta'}</span></div>
          <div className="alertDetails"><span><b>{a.variable === 'CO2' ? 'CO₂' : a.variable}</b> · {number(a.valorMedido)} {units[a.variable]} · ICG {a.nivel}</span><span>Nodo de origen: {a.nodoNombre || a.nodoId}</span><span>Ventana de confirmación: {formatDate(a.ventanaConfirmacion, dateOptions)}</span><span>Registrada: {formatDate(a.timestamp, dateOptions)}</span>{a.resueltaEn && <span>Resuelta en: {formatDate(a.resueltaEn, dateOptions)}</span>}{filters.orden === 'duracion' && <span>Duración: {duration(a, filters.corte)}</span>}</div>
          {a.estado === 'activa' && <p className="alertFreshness">{recent ? 'Sala con datos recientes' : 'Sin datos recientes en la sala'} · Última ventana: {a.ventanaTimestamp ? formatDate(a.ventanaTimestamp, dateOptions) : 'sin ventana verificable'}</p>}
        </article>;
      })}</div>}
      <div className="alertActions"><button type="button" className="secondary" disabled={page === 1} onClick={() => changePage(page - 1)}>Anterior</button><span>Página {page}</span><button type="button" className="secondary" disabled={!result.hayMas} onClick={() => changePage(page + 1)}>Siguiente</button></div>
      {filters.orden === 'duracion' && <p className="helper">La duración se calcula desde la confirmación hasta la resolución o, si sigue activa, hasta {formatDate(filters.corte, dateOptions)}. Cambia un filtro para actualizar ese momento.</p>}
    </section>}
  </div>;
}
