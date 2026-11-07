import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from './services';
import HistoryRoomPicker from './HistoryRoomPicker';
import HistoryDateDialog from './HistoryDateDialog';
import { formatDate, number } from './domain';

/** Nombre: localDate. Razón: representar fechas del navegador en controles locales.
 * Entradas: fecha. Salida: texto datetime-local. Efectos: ninguno. */
export function localDate(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Nombre: HistoryPage. Razón: mantener consulta aplicada independiente de filtros editados.
 * Entradas: componentes compartidos y sala opcional en URL. Salida: análisis histórico. Efectos: consultas de lectura y descargas. */
export default function HistoryPage({
  Chart,
  Table
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [room, setRoom] = useState(() => location.state?.historicoSala || '');
  const [rooms, setRooms] = useState([]),
    [loading, setLoading] = useState(true),
    [period, setPeriod] = useState('1'),
    [from, setFrom] = useState(() => localDate(new Date(Date.now() - 86400000))),
    [to, setTo] = useState(() => localDate(new Date())),
    [rows, setRows] = useState([]),
    [tableRows, setTableRows] = useState([]),
    [total, setTotal] = useState(0),
    [stats, setStats] = useState([]),
    [pageBusy, setPageBusy] = useState(false),
    [applied, setApplied] = useState(null),
    [busy, setBusy] = useState(false),
    [downloading, setDownloading] = useState(''),
    [error, setError] = useState(''),
    [page, setPage] = useState(1),
    [undated, setUndated] = useState(0),
    [undatedStatus, setUndatedStatus] = useState('idle');
  const [dateDialog, setDateDialog] = useState(false);
  const version = useRef(0),
    downloadLock = useRef(false);
  useEffect(() => {
    const linkedRoom = location.state?.historicoSala;
    const next = new URLSearchParams(location.search);
    const oldRoom = next.has('sala');
    if (!linkedRoom && !oldRoom) return;
    if (linkedRoom) setRoom(linkedRoom);
    next.delete('sala');
    const search = next.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash },
      { replace: true, state: null });
  }, [location, navigate]);
  useEffect(() => {
    version.current++;
    setBusy(false);
    setPageBusy(false);
  }, [room]);
  useEffect(() => {
    let active = true;
    api.rooms({}).then(data => {
      if (active) {
        setRooms(data);
        setError('');
      }
    }).catch(e => {
      if (active) setError(e.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      version.current++;
    };
  }, []);
  const currentRoom = rooms.find(r => r.id === room),
    changed = applied && (room !== applied.room || period !== applied.period || period === 'custom' && (from !== applied.from || to !== applied.to)),
    pages = Math.max(1, Math.ceil(total / 50)),
    current = Math.min(page, pages);
  /** Nombre: preset. Razón: acotar rangos frecuentes. Entradas: días. Salida: filtros locales. Efectos: ninguno persistente. */
  function preset(days) {
    const end = new Date();
    setTo(localDate(end));
    setFrom(localDate(new Date(end.getTime() - days * 86400000)));
  }
  /** Nombre: chooseRoom. Razón: mantener la elección solo durante la visita actual.
   * Entradas: identificador elegido. Salida: filtro actualizado. Efectos: estado local. */
  function chooseRoom(id) {
    setRoom(id);
  }
  /** Nombre: queryHistory. Razón: asociar datos y exportaciones a la misma consulta.
   * Entradas: filtros validados. Salida: filas y consulta aplicada. Efectos: GET de telemetría. */
  async function queryHistory(e) {
    e.preventDefault();
    if (!currentRoom || busy) return;
    if (period === 'custom' && (!from || !to || new Date(from) > new Date(to))) {
      setError('Selecciona un rango válido: Desde debe ser anterior a Hasta.');
      return;
    }
    const id = ++version.current;
    const end = period === 'custom' ? to : localDate(new Date()),
      start = period === 'custom' ? from : localDate(new Date(Date.now() - Number(period) * 86400000));
    const snapshot = {
      room,
      from: start,
      to: end,
      period,
      name: [currentRoom.sectorNombre, currentRoom.edificioNombre, currentRoom.pisoNombre, currentRoom.nombre].filter(Boolean).join(' › '),
      desde: new Date(start).toISOString(),
      hasta: new Date(end).toISOString()
    };
    setBusy(true);
    setError('');
    setUndatedStatus('idle');
    try {
      setFrom(start);
      setTo(end);
      const [summary, firstPage] = await Promise.all([
        api.historySummary(room, { desde: snapshot.desde, hasta: snapshot.hasta }),
        api.historyPage(room, { desde: snapshot.desde, hasta: snapshot.hasta, pagina: 1 })
      ]);
      if (id === version.current) {
        setRows(summary.grafico);
        setStats(summary.stats);
        setTotal(summary.total);
        setTableRows(firstPage);
        setUndated(0);
        setApplied(snapshot);
        setPage(1);
        setUndatedStatus('loading');
        api.telemetryWithoutDate(room).then(pending => {
          if (id === version.current) {
            setUndated(Number(pending.total || 0));
            setUndatedStatus('ready');
          }
        }).catch(() => {
          if (id === version.current) setUndatedStatus('error');
        });
      }
    } catch (e) {
      if (id === version.current) setError(e.message);
    } finally {
      if (id === version.current) setBusy(false);
    }
  }
  /** Nombre: loadPage. Razón: consultar solo las ventanas de la página elegida.
   * Entradas: número de página y consulta aplicada. Salida: filas y página actualizadas.
   * Efectos: petición de lectura; ignora respuestas de una consulta anterior. */
  async function loadPage(next) {
    if (!applied || room !== applied.room || busy || pageBusy || next < 1 || next > pages) return;
    const id = version.current;
    setPageBusy(true);
    setError('');
    try {
      const data = await api.historyPage(applied.room, {
        desde: applied.desde, hasta: applied.hasta, pagina: next
      });
      if (id === version.current) {
        setTableRows(data);
        setPage(next);
      }
    } catch (e) {
      if (id === version.current) setError(e.message);
    } finally {
      if (id === version.current) setPageBusy(false);
    }
  }
  /** Nombre: download. Razón: exportar el rango aplicado con bloqueo de duplicados.
   * Entradas: formato. Salida: archivo descargado. Efectos: descarga de lectura, sin modificar datos. */
  async function download(format) {
    if (!applied || downloadLock.current) return;
    downloadLock.current = true;
    setDownloading(format);
    setError('');
    try {
      const blob = await api.exportRoom(applied.room, format, {
        desde: applied.desde,
        hasta: applied.hasta
      });
      const url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = `aira-${applied.room}-${applied.desde.slice(0, 10)}.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e.message);
    } finally {
      downloadLock.current = false;
      setDownloading('');
    }
  }
  return (
    <div className="historyPage">
      <div className="pageHeading">
        <div>
          <span className="eyebrow">ANÁLISIS</span>
          <h1>Histórico</h1>
          <p>Consulta mediciones verificadas y recuperadas con hora estimada.</p>
        </div>
      </div>

      <section className="panel">
        <form onSubmit={queryHistory}>
          <div className="historyToolbar">
            <HistoryRoomPicker rooms={rooms} value={room} onChange={chooseRoom} disabled={loading}>
              <label>
                Período
                <select value={period} onChange={e => {
                  const next = e.target.value;
                  if (next === 'custom') setDateDialog(true);
                  else {
                    setPeriod(next);
                    preset(Number(next));
                  }
                }}>
                  <option value="1">Últimas 24 horas</option>
                  <option value="7">Últimos 7 días</option>
                  <option value="30">Últimos 30 días</option>
                  <option value="custom">Personalizado…</option>
                </select>
              </label>
              <button className="primary" disabled={!currentRoom || busy || pageBusy}>
                {busy ? 'Consultando…' : 'Consultar'}
              </button>
            </HistoryRoomPicker>
          </div>

          {period === 'custom' && (
            <p className="helper">
              {from.replace('T', ' ')} — {to.replace('T', ' ')}{' '}
              <button type="button" className="secondary compact" onClick={() => setDateDialog(true)}>
                Editar período
              </button>
            </p>
          )}
          {dateDialog && (
            <HistoryDateDialog from={from} to={to} onCancel={() => setDateDialog(false)}
              onApply={(start, end) => {
                setFrom(start);
                setTo(end);
                setPeriod('custom');
                setDateDialog(false);
              }} />
          )}
          <p className="helper">
            Fechas en {Intl.DateTimeFormat().resolvedOptions().timeZone}. Las horas estimadas se identifican; las ventanas sin fecha quedan fuera del gráfico.
          </p>
        </form>
        {changed && <p role="status">Filtros modificados. Pulsa Consultar para actualizar los resultados.</p>}
        {error && <div className="notice error" role="alert">{error}</div>}
      </section>

      {busy && !applied && (
        <>
          <section className="panel historyLoadingApplied" role="status" aria-live="polite">
            <b>Consultando histórico…</b><p>Preparando las mediciones del período.</p>
          </section>
          <section className="panel chartPanel historyLoadingChart" aria-hidden="true"><h2>Evolución de las mediciones</h2></section>
          <section className="panel historyLoadingSummary" aria-hidden="true"><h2>Resumen del período completo</h2></section>
          <section className="panel historyLoadingTable" aria-hidden="true"><h2>Ventanas consultadas</h2></section>
        </>
      )}

      {applied && (
        <section className="panel historyApplied">
          <b>{applied.name}</b>
          <p>
            {formatDate(applied.desde, { dateStyle: 'medium', timeStyle: 'short' })} — {formatDate(applied.hasta, { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
          <div className="inlineActions">
            <button className="secondary compact" disabled={Boolean(downloading) || busy} onClick={() => download('csv')}>Exportar CSV</button>
            <button className="secondary compact" disabled={Boolean(downloading) || busy} onClick={() => download('json')}>Exportar JSON</button>
            {downloading && <span role="status">Preparando descarga…</span>}
          </div>
          <small>Exporta todas las ventanas fechadas del rango aplicado.</small>
          {undatedStatus === 'loading' && <p role="status">Comprobando ventanas sin fecha…</p>}
          {undatedStatus === 'error' && (
            <p className="notice error" role="alert">No se pudo comprobar cuántas ventanas carecen de fecha. Las mediciones mostradas sí se cargaron.</p>
          )}
          {undatedStatus === 'ready' && undated > 0 && (
            <p role="status">{undated} ventanas de esta sala conservan sus datos, pero no tienen fecha recuperable.</p>
          )}
        </section>
      )}

      {applied && total > 0 ? (
        <>
          <section className="panel chartPanel">
            <h2>Evolución de las mediciones</h2>
            <p>{total} ventanas · {rows.length} puntos representativos · se conservan extremos y huecos · naranja: hora estimada.</p>
            <Chart rows={rows} />
          </section>
          <section className="panel">
            <h2>Resumen del período completo</h2>
            <div className="tableScroll">
              <table>
                <thead><tr><th>Variable</th><th>Valores válidos</th><th>Promedio</th><th>Mínimo</th><th>Máximo</th></tr></thead>
                <tbody>
                  {stats.map((stat, i) => (
                    <tr key={stat.key}>
                      <td>{['CO₂ (ppm)', 'PM₂.₅ (µg/m³)', 'PM₁₀ (µg/m³)', 'Temperatura (°C)', 'Humedad (%)'][i]}</td>
                      <td>{stat.count} / {total}</td>
                      <td>{number(stat.avg)}</td>
                      <td>{number(stat.min)}</td>
                      <td>{number(stat.max)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <h2>Ventanas consultadas</h2>
            <nav className="historyPages" aria-label="Páginas de mediciones">
              <span>{total} ventanas · página {current} de {pages}{pageBusy ? ' · Cargando…' : ''}</span>
              <button className="secondary compact" disabled={current === 1 || pageBusy || busy || room !== applied.room} onClick={() => loadPage(current - 1)}>Anterior</button>
              <button className="secondary compact" disabled={current === pages || pageBusy || busy || room !== applied.room} onClick={() => loadPage(current + 1)}>Siguiente</button>
            </nav>
            <Table rows={tableRows} />
          </section>
        </>
      ) : !busy && (
        <div className="empty">
          <b>{applied ? 'No hay mediciones para la consulta aplicada' : 'Elige una sala y un período'}</b>
          <span>{applied ? 'Prueba otro período o sala y vuelve a consultar.' : 'Pulsa Consultar para cargar el histórico.'}</span>
        </div>
      )}
    </div>
  );
}
