import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, live } from './services';
import { formatDate, hasRecentRoomData, number } from './domain';

const units = { CO2: 'ppm', 'PM2.5': 'µg/m³', PM10: 'µg/m³', Temperatura: '°C', Humedad: '%' };
const dateOptions = { dateStyle: 'short', timeStyle: 'short' };
const emptyFilters = { salaId: '', estado: '', variable: '', desde: '', hasta: '' };

/** Nombre: AlertsPage. Razón: consultar alertas autorizadas sin confundirlas con el estado actual.
 * Entradas: sesión vigente y eventos de telemetría. Salida: filtros y página de alertas.
 * Efectos: consultas de solo lectura y estado local de la interfaz. */
export default function AlertsPage() {
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState(null);
  const [matches, setMatches] = useState([]);
  const [searchError, setSearchError] = useState('');
  const [now, setNow] = useState(Date.now());
  const request = useRef(0);
  const refreshTimer = useRef(null);

  useEffect(() => {
    if (selected || term.trim().length < 2) { setMatches([]); setSearchError(''); return; }
    let active = true;
    setMatches([]);
    const timer = setTimeout(() => api.historyRooms(term.trim()).then(rows => {
      if (active) { setMatches(rows); setSearchError(''); }
    }).catch(e => { if (active) { setMatches([]); setSearchError(e.message); } }), 300);
    return () => { active = false; clearTimeout(timer); };
  }, [term, selected]);

  /** Nombre: refresh. Razón: evita que una respuesta antigua sobrescriba la consulta vigente.
   * Entradas: filtros aplicados y página. Salida: resultados o error. Efectos: lectura de API y estado local. */
  const refresh = useCallback(async () => {
    const revision = ++request.current;
    setBusy(true);
    try {
      const params = { ...applied, pagina: page };
      if (params.desde) params.desde = new Date(params.desde).toISOString();
      if (params.hasta) params.hasta = new Date(new Date(params.hasta).getTime() + 59999).toISOString();
      const response = await api.alertsPage(params);
      if (request.current === revision) { setResult(response); setError(''); }
    } catch (e) {
      if (request.current === revision) { setResult(null); setError(e.message); }
    } finally {
      if (request.current === revision) setBusy(false);
    }
  }, [applied, page]);

  useEffect(() => { refresh(); return () => { request.current++; }; }, [refresh]);
  useEffect(() => {
    const schedule = () => { clearTimeout(refreshTimer.current); refreshTimer.current = setTimeout(refresh, 1000); };
    const offEvent = live.subscribe(event => { if (event.tipo === 'ventana' || event.tipo === 'alerta') schedule(); });
    let previous = live.status;
    const offStatus = live.subscribeStatus(status => { if (status === 'connected' && previous !== 'connected') schedule(); previous = status; });
    return () => { offEvent(); offStatus(); clearTimeout(refreshTimer.current); };
  }, [refresh]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);

  /** Nombre: submit. Razón: valida y aplica los filtros de forma conjunta.
   * Entradas: formulario de búsqueda. Salida: consulta inicial. Efectos: actualiza estado local. */
  function submit(event) {
    event.preventDefault();
    if (term.trim() && !selected) { setError('Selecciona una sala de los resultados o limpia la búsqueda.'); return; }
    if (filters.desde && filters.hasta && new Date(filters.desde) > new Date(filters.hasta)) {
      setError('La fecha inicial debe ser anterior a la fecha final.'); return;
    }
    setError('');
    if (page === 1 && JSON.stringify(filters) === JSON.stringify(applied)) refresh();
    else { setPage(1); setApplied({ ...filters }); }
  }

  const update = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  return <div className="alertsPage">
    <div className="pageHeading"><div><span className="eyebrow">OPERACIÓN / 08</span><h1>Registro de alertas</h1><p>Alertas confirmadas y su evolución por sala.</p></div><button type="button" className="secondary" onClick={refresh} disabled={busy}>Actualizar</button></div>
    <form className="panel alertSearch" onSubmit={submit}>
      <div className="alertSearchGrid">
        <div className="alertRoomSearch"><label htmlFor="alertRoom">Sala o nodo</label><input id="alertRoom" type="search" value={term} autoComplete="off" placeholder="Buscar sala, ubicación o nodo" onChange={e => { setTerm(e.target.value); setSelected(null); update('salaId', ''); }} />
          {selected ? <small>Seleccionada: {[selected.sectorNombre, selected.edificioNombre, selected.pisoNombre, selected.nombre].filter(Boolean).join(' › ')}</small> : <small>Escribe al menos dos caracteres y selecciona una sala. La búsqueda por nodo localiza su sala.</small>}
          {searchError && <p className="notice error" role="alert">No se pudo buscar la sala: {searchError}</p>}
          {!selected && matches.length > 0 && <div className="alertRoomMatches">{matches.map(room => <button type="button" key={room.id} onClick={() => { setSelected(room); setTerm(room.nombre); setMatches([]); update('salaId', room.id); }}>{[room.sectorNombre, room.edificioNombre, room.pisoNombre, room.nombre].filter(Boolean).join(' › ')}</button>)}</div>}
        </div>
        <label>Estado<select value={filters.estado} onChange={e => update('estado', e.target.value)}><option value="">Todos</option><option value="activa">Activa</option><option value="resuelta">Resuelta</option></select></label>
        <label>Variable<select value={filters.variable} onChange={e => update('variable', e.target.value)}><option value="">Todas</option>{Object.keys(units).map(key => <option key={key} value={key}>{key === 'CO2' ? 'CO₂' : key}</option>)}</select></label>
        <label>Desde<input type="datetime-local" value={filters.desde} onChange={e => update('desde', e.target.value)} /></label>
        <label>Hasta<input type="datetime-local" value={filters.hasta} onChange={e => update('hasta', e.target.value)} /></label>
      </div>
      <div className="alertActions"><button type="button" className="secondary" onClick={() => { setFilters(emptyFilters); setTerm(''); setSelected(null); setMatches([]); }}>Limpiar filtros</button><button className="primary">Consultar</button></div>
    </form>
    <p className="helper">La medición y el nivel corresponden a la ventana que confirmó la alerta. Una alerta activa permanece abierta mientras no llegue una ventana completa que permita resolverla.</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    {busy ? <p role="status">Cargando alertas…</p> : result && <section className="panel alertResults"><div className="panelHead"><h2>Alertas</h2><span>Página {page} · {result.alertas.length} resultados{result.hayMas ? ' · hay más resultados' : ''}</span></div>
      {!result.alertas.length ? <p>No hay alertas para los filtros aplicados.</p> : <div className="alertList">{result.alertas.map(a => {
        const recent = hasRecentRoomData({ nodoId: a.nodoActualId, ultimaTelemetria: a.ultimaTelemetria, ventanaTimestamp: a.ventanaTimestamp }, now);
        return <article className="alertItem" key={a.id}><div className="alertItemHead"><div><Link to={'/salas/' + encodeURIComponent(a.salaId)}><b>{a.salaNombre}</b></Link><small>{[a.sectorNombre, a.edificioNombre, a.pisoNombre].filter(Boolean).join(' › ')}</small></div><span className={'badge ' + (a.estado === 'activa' ? 'bad' : 'good')}>{a.estado === 'activa' ? 'Activa' : 'Resuelta'}</span></div>
          <div className="alertDetails"><span><b>{a.variable === 'CO2' ? 'CO₂' : a.variable}</b> · {number(a.valorMedido)} {units[a.variable]} · ICG {a.nivel}</span><span>Ventana de confirmación: {formatDate(a.ventanaConfirmacion, dateOptions)}</span><span>Registrada: {formatDate(a.timestamp, dateOptions)}</span>{a.resueltaEn && <span>Resuelta en: {formatDate(a.resueltaEn, dateOptions)}</span>}</div>
          {a.estado === 'activa' && <p className="alertFreshness">{recent ? 'Sala con datos recientes' : 'Sin datos recientes en la sala'} · Última ventana: {a.ventanaTimestamp ? formatDate(a.ventanaTimestamp, dateOptions) : 'sin ventana verificable'}</p>}
        </article>;
      })}</div>}
      <div className="alertActions"><button type="button" className="secondary" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior</button><span>Página {page}</span><button type="button" className="secondary" disabled={!result.hayMas} onClick={() => setPage(p => p + 1)}>Siguiente</button></div>
    </section>}
  </div>;
}
