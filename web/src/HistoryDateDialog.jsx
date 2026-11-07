import React, { useEffect, useRef, useState } from 'react';
const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
/** Nombre: validLocalDate. Razón: detectar fechas inexistentes y horas omitidas por cambios de horario.
 * Entradas: fecha y hora locales. Salida: true si el navegador conserva sus componentes. Efectos: ninguno. */
export function validLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const pad = number => String(number).padStart(2, '0');
  const actual = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return actual === value;
}
/** Nombre: Calendar. Razón: elegir fecha y hora del rango. Entradas: valor y callback. Salida: calendario. Efectos: actualiza borrador. */
function Calendar({
  title,
  value,
  onChange
}) {
  const [date, time] = value.split('T'),
    [year, month, day] = date.split('-').map(Number),
    [y, setY] = useState(year),
    [m, setM] = useState(month);
  const count = new Date(y, m, 0).getDate(),
    offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const pad = n => String(n).padStart(2, '0');
  return <section className="historyCalendar" aria-label={title}><h3>{title}</h3><div className="historyCalendarNav"><label>Mes<select value={m} onChange={e => setM(Number(e.target.value))}>{months.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}</select></label><label>Año<input type="number" min="1900" max="9999" value={y} onChange={e => setY(Number(e.target.value))} /></label></div><div className="historyCalendarGrid">{['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'].map(d => <b key={d}>{d}</b>)}{Array.from({
        length: offset
      }, (_, i) => <span key={'v' + i} />)}{Array.from({
        length: count
      }, (_, i) => {
        const d = i + 1,
          selected = year === y && month === m && day === d;
        return <button type="button" key={d} className={selected ? 'selected' : ''} aria-pressed={selected} aria-label={`${d} de ${months[m - 1]} de ${y}`} onClick={() => {
          if (y >= 1900 && y <= 9999) onChange(`${y}-${pad(m)}-${pad(d)}T${time}`);
        }}>{d}</button>;
      })}</div><label>Hora<input type="time" value={time} onChange={e => onChange(`${date}T${e.target.value}`)} /></label><small>Seleccionado: {date.split('-').reverse().join('-')} {time}</small></section>;
}
/** Nombre: HistoryDateDialog. Razón: preparar un rango antes de aplicarlo. Entradas: fechas y callbacks. Salida: diálogo. Efectos: confirma filtros. */
export default function HistoryDateDialog({
  from,
  to,
  onCancel,
  onApply
}) {
  const [start, setStart] = useState(from),
    [end, setEnd] = useState(to),
    [error, setError] = useState(''),
    ref = useRef(null);
  useEffect(() => {
    const opener = document.activeElement,
      dialog = ref.current;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  /** Nombre: apply. Razón: validar el período antes de consultarlo. Entradas: fechas del borrador. Salida: rango confirmado o error. Efectos: actualiza el filtro mediante callback. */
  function apply() {
    if (!validLocalDate(start) || !validLocalDate(end) || new Date(start) > new Date(end)) {
      setError('Selecciona fechas y horas válidas: el inicio debe ser anterior o igual al final.');
      return;
    }
    onApply(start, end);
  }
  return <dialog ref={ref} className="userDialog historyDateDialog" aria-labelledby="history-date-title" onCancel={e => {
    e.preventDefault();
    onCancel();
  }}><h2 id="history-date-title">Período personalizado</h2><p>Selecciona las fechas y horas en tu zona horaria local.</p><div className="historyCalendars"><Calendar title="Inicio" value={start} onChange={setStart} /><Calendar title="Final" value={end} onChange={setEnd} /></div>{error && <p role="alert" className="notice error">{error}</p>}<div className="dialogActions"><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button type="button" className="primary" onClick={apply}>Aplicar</button></div></dialog>;
}
