import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  const [params, setParams] = useSearchParams();
  const room = params.get('sala') || '';
  const [rooms, setRooms] = useState([]),
    [loading, setLoading] = useState(true),
    [period, setPeriod] = useState('1'),
    [from, setFrom] = useState(() => localDate(new Date(Date.now() - 86400000))),
    [to, setTo] = useState(() => localDate(new Date())),
    [rows, setRows] = useState([]),
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
    version.current++;
    setBusy(false);
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
    pages = Math.max(1, Math.ceil(rows.length / 50)),
    current = Math.min(page, pages);
  const stats = useMemo(() => ['co2', 'pm25', 'pm10', 'temperatura', 'humedad'].map(key => {
    const values = rows.map(r => r[key]).filter(v => v != null && Number.isFinite(v));
    return {
      key,
      count: values.length,
      avg: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null
    };
  }), [rows]);
  /** Nombre: preset. Razón: acotar rangos frecuentes. Entradas: días. Salida: filtros locales. Efectos: ninguno persistente. */
  function preset(days) {
    const end = new Date();
    setTo(localDate(end));
    setFrom(localDate(new Date(end.getTime() - days * 86400000)));
  }
  /** Nombre: chooseRoom. Razón: mantener la sala de Histórico sincronizada con la URL.
   * Entradas: identificador elegido. Salida: parámetro sala actualizado. Efectos: navegación local. */
  function chooseRoom(id) {
    const next = new URLSearchParams(params);
    if (id) next.set('sala', id);else next.delete('sala');
    setParams(next, {
      replace: true
    });
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
      const data = await api.telemetry(room, {
        desde: snapshot.desde,
        hasta: snapshot.hasta,
        limite: 10000
      });
      if (id === version.current) {
        setRows(data.slice().reverse());
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
  return <div className="historyPage"><div className="pageHeading"><div><span className="eyebrow">ANÁLISIS</span><h1>Histórico</h1><p>Consulta mediciones verificadas y recuperadas con hora estimada.</p></div></div><section className="panel"><form onSubmit={queryHistory}><div className="historyToolbar"><HistoryRoomPicker rooms={rooms} value={room} onChange={chooseRoom} disabled={loading}><label>Período<select value={period} onChange={e => {
                const next = e.target.value;
                if (next === 'custom') setDateDialog(true);else {
                  setPeriod(next);
                  preset(Number(next));
                }
              }}><option value="1">Últimas 24 horas</option><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="custom">Personalizado…</option></select></label><button className="primary" disabled={!currentRoom || busy}>{busy ? 'Consultando…' : 'Consultar'}</button></HistoryRoomPicker></div>{period === 'custom' && <p className="helper">{from.replace('T', ' ')} — {to.replace('T', ' ')} <button type="button" className="secondary compact" onClick={() => setDateDialog(true)}>Editar período</button></p>}{dateDialog && <HistoryDateDialog from={from} to={to} onCancel={() => setDateDialog(false)} onApply={(start, end) => {
          setFrom(start);
          setTo(end);
          setPeriod('custom');
          setDateDialog(false);
        }} />}<p className="helper">Fechas en {Intl.DateTimeFormat().resolvedOptions().timeZone}. Las horas estimadas se identifican; las ventanas sin fecha quedan fuera del gráfico.</p></form>{changed && <p role="status">Filtros modificados. Pulsa Consultar para actualizar los resultados.</p>}{error && <div className="notice error" role="alert">{error}</div>}</section>{applied && <section className="panel historyApplied"><b>{applied.name}</b><p>{formatDate(applied.desde, {
          dateStyle: 'medium',
          timeStyle: 'short'
        })} — {formatDate(applied.hasta, {
          dateStyle: 'medium',
          timeStyle: 'short'
        })}</p><div className="inlineActions"><button className="secondary compact" disabled={Boolean(downloading) || busy} onClick={() => download('csv')}>Exportar CSV</button><button className="secondary compact" disabled={Boolean(downloading) || busy} onClick={() => download('json')}>Exportar JSON</button>{downloading && <span role="status">Preparando descarga…</span>}</div><small>Exporta todas las ventanas fechadas del rango aplicado, aunque la vista alcance su límite.</small>{undatedStatus === 'loading' && <p role="status">Comprobando ventanas sin fecha…</p>}{undatedStatus === 'error' && <p className="notice error" role="alert">No se pudo comprobar cuántas ventanas carecen de fecha. Las mediciones mostradas sí se cargaron.</p>}{undatedStatus === 'ready' && undated > 0 && <p role="status">{undated} ventanas de esta sala conservan sus datos, pero no tienen fecha recuperable.</p>}</section>}{rows.length >= 10000 && <div className="notice" role="status">Se alcanzó el límite de 10.000 ventanas. La vista y su resumen podrían cubrir sólo la parte más reciente del período. Acota las fechas o exporta el rango completo.</div>}{applied && rows.length > 0 ? <><section className="panel chartPanel"><h2>Evolución de las mediciones</h2><p>{rows.length} ventanas mostradas · puntos naranjas: hora estimada · los huecos no se interpolan.</p><Chart rows={rows} /></section><section className="panel"><h2>Resumen de las ventanas mostradas</h2><div className="tableScroll"><table><thead><tr><th>Variable</th><th>Valores válidos</th><th>Promedio</th><th>Mínimo</th><th>Máximo</th></tr></thead><tbody>{stats.map((stat, i) => <tr key={stat.key}><td>{['CO₂ (ppm)', 'PM₂.₅ (µg/m³)', 'PM₁₀ (µg/m³)', 'Temperatura (°C)', 'Humedad (%)'][i]}</td><td>{stat.count} / {rows.length}</td><td>{number(stat.avg)}</td><td>{number(stat.min)}</td><td>{number(stat.max)}</td></tr>)}</tbody></table></div></section><section className="panel"><h2>Ventanas consultadas</h2><nav className="historyPages" aria-label="Páginas de mediciones"><span>{rows.length} ventanas · página {current} de {pages}</span><button className="secondary compact" disabled={current === 1} onClick={() => setPage(current - 1)}>Anterior</button><button className="secondary compact" disabled={current === pages} onClick={() => setPage(current + 1)}>Siguiente</button></nav><Table rows={rows.slice((current - 1) * 50, current * 50)} /></section></> : !busy && <div className="empty"><b>{applied ? 'No hay mediciones para la consulta aplicada' : 'Elige una sala y un período'}</b><span>{applied ? 'Prueba otro período o sala y vuelve a consultar.' : 'Pulsa Consultar para cargar el histórico.'}</span></div>}</div>;
}
