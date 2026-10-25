import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Building2, ChevronRight, CircleAlert, Grid2X2, Search, Wifi, WifiOff } from 'lucide-react';
import { api, live } from './services';
import { formatDate, number, SEVERITY } from './domain';

const tone = score => ['good', 'caution', 'poor', 'bad', 'critical'][score] || 'muted';
const status = state => state?.icgEstado === 'completo' && state.icgScore != null ? `${state.icgScore} · ${SEVERITY[state.icgScore]}` : 'Dato insuficiente';
const badge = state => <span className={`badge ${tone(state?.icgScore)}`}>{status(state)}</span>;
const count = (states, predicate) => states.filter(predicate).length;

function Summary({ cards }) {
  return <div className="statGrid locationStats">{cards.map(([label, value, note, color]) => <article className={`statCard ${color || ''}`} key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</div>;
}

function RoomTile({ room, state, compact = false }) {
  return <Link to={`/salas/${room.id}`} className={`locationRoom ${compact ? 'compactRoom' : ''}`}>
    <div className="locationRoomTop"><div><span className="eyebrow">{state?.pisoNombre || 'ESPACIO MONITORIZADO'}</span><h3>{room.nombre}</h3></div>{badge(state)}</div>
    {!compact && <><div className="locationRoomMetrics">{[['CO₂', state?.co2, 'ppm'], ['PM₂.₅', state?.pm25, 'µg/m³'], ['PM₁₀', state?.pm10, 'µg/m³'], ['Temperatura', state?.temperatura, '°C'], ['Humedad', state?.humedad, '%']].map(([label, value, unit]) => <div key={label}><small>{label}</small><b>{number(value)}</b><em>{unit}</em></div>)}</div><div className="locationRoomFoot"><span>{state?.nodoEstado === 'conectado' ? <Wifi size={14}/> : <WifiOff size={14}/>} Nodo {state?.nodoEstado === 'conectado' ? 'conectado' : 'sin conexión'}</span><span>{formatDate(state?.ventanaTimestamp, {dateStyle:'short', timeStyle:'short'})}</span><ArrowRight size={16}/></div></>}
    {compact && <span className="roomTileArrow"><ArrowRight size={15}/></span>}
  </Link>;
}

export default function PenpotLocations({ kind }) {
  const params = useParams();
  const id = params.sectorId || params.edificioId || params.pisoId;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('todos');
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    (async () => {
      try {
        const [sectors, buildings, rooms] = await Promise.all([api.sectors(), api.buildings(), api.rooms({})]);
        const floors = (await Promise.all(buildings.map(building => api.floors(building.id).catch(() => [])))).flat();
        const states = await Promise.all(rooms.map(async room => { try { return await api.state(room.id); } catch { return { salaId: room.id, salaNombre: room.nombre, icgEstado: 'dato_insuficiente' }; } }));
        if (active) setData({ sectors, buildings, floors, rooms, states });
      } catch (cause) { if (active) setError(cause.message); }
    })();
    return () => { active = false; };
  }, [kind, id]);

  useEffect(() => live.subscribe(event => {
    if (event.tipo !== 'ventana' || !event.salaId) return;
    api.state(event.salaId).then(fresh => setData(current => current && ({
      ...current,
      states: current.states.map(state => state.salaId === fresh.salaId ? fresh : state),
    }))).catch(() => {});
  }), []);

  const current = useMemo(() => {
    if (!data) return null;
    const place = kind === 'sector' ? data.sectors.find(item => item.id === id) : kind === 'building' ? data.buildings.find(item => item.id === id) : data.floors.find(item => item.id === id);
    const buildings = kind === 'sector' ? data.buildings.filter(item => item.sectorId === id) : kind === 'building' ? data.buildings.filter(item => item.id === id) : data.buildings.filter(item => data.floors.some(floor => floor.id === id && floor.edificioId === item.id));
    const floors = data.floors.filter(item => buildings.some(building => building.id === item.edificioId) && (kind !== 'floor' || item.id === id));
    const rooms = data.rooms.filter(item => floors.some(floor => floor.id === item.pisoId));
    const states = rooms.map(room => data.states.find(state => state.salaId === room.id));
    return { place, buildings, floors, rooms, states };
  }, [data, kind, id]);

  if (error) return <div className="notice error"><CircleAlert size={18}/>{error}</div>;
  if (!current) return <div className="loading">Cargando espacios…</div>;
  if (!current.place) return <div className="notice error">El espacio solicitado no existe o no tienes acceso.</div>;

  const { place, buildings, floors, rooms, states } = current;
  const good = count(states, state => state?.icgEstado === 'completo' && state.icgScore === 0);
  const attention = count(states, state => state?.icgEstado === 'completo' && state.icgScore >= 2);
  const connected = count(states, state => state?.nodoEstado === 'conectado');
  const parent = kind === 'sector' ? '/dashboard' : kind === 'building' ? `/sectores/${place.sectorId}` : `/edificios/${place.edificioId}`;
  const parentLabel = kind === 'sector' ? 'Vista general' : kind === 'building' ? 'Volver al sector' : 'Volver al edificio';

  return <div className={`penpotLocation ${kind}`}>
    <div className="pageHeading"><div><span className="eyebrow">MONITOREO AMBIENTAL / {kind === 'sector' ? 'SECTOR' : kind === 'building' ? 'EDIFICIO' : 'PISO'}</span><h1>{place.nombre}</h1><p>Explora el estado ambiental de los espacios y sus últimas ventanas verificables.</p></div><Link className="secondary" to={parent}><ArrowLeft size={16}/>{parentLabel}</Link></div>
    {kind === 'sector' && <>
      <Summary cards={[["Edificios", buildings.length, 'En este sector'], ["Pisos", floors.length, 'Con espacios monitorizados'], ["Salas monitorizadas", rooms.length, 'En este sector'], ["Condición óptima", good, 'Con dato completo', 'green']]}/>
      <div className="sectionTitle"><h2>Estado por edificio</h2><span>{buildings.length} edificios en el sector</span></div>
      <div className="buildingGrid">{buildings.map(building => {const buildingRooms = rooms.filter(room => room.edificioId === building.id); const buildingStates = buildingRooms.map(room => data.states.find(state => state.salaId === room.id)); return <Link className="buildingCard" to={`/edificios/${building.id}`} key={building.id}><div className="buildingCardTop"><span className="buildingIcon"><Building2 size={23}/></span><span className={`badge ${buildingStates.some(state => state?.icgScore >= 2) ? 'bad' : 'good'}`}>{buildingStates.some(state => state?.icgScore >= 2) ? 'Requiere atención' : 'Operativo'}</span></div><h3>{building.nombre}</h3><p>{data.floors.filter(floor => floor.edificioId === building.id).length} pisos · {buildingRooms.length} salas monitorizadas</p><div className="buildingCardMeta"><span><b>{count(buildingStates, state => state?.icgScore === 0)}</b> óptimas</span><span><b>{count(buildingStates, state => state?.nodoEstado === 'conectado')}</b> conectadas</span><span><b>{count(buildingStates, state => state?.icgScore >= 2)}</b> alertas</span></div><div className="buildingCardBottom">Ver edificio <ArrowRight size={17}/></div></Link>})}</div>
    </>}
    {kind === 'building' && <>
      <div className="buildingOverview"><Building2 size={27}/><div><b>{rooms.length} {rooms.length === 1 ? 'sala monitorizada' : 'salas monitorizadas'} en {floors.length} {floors.length === 1 ? 'piso' : 'pisos'}</b><span>{connected} {connected === 1 ? 'nodo conectado' : 'nodos conectados'} · {attention} {attention === 1 ? 'sala requiere' : 'salas requieren'} atención</span></div><span className="badge infoBadge">Actualización en tiempo real</span></div>
      <Summary cards={[["Pisos", floors.length, 'En este edificio'], ["Salas monitorizadas", rooms.length, 'Con sensores asignados'], ["Condición óptima", good, 'Con dato completo', 'green'], ["Nodos conectados", `${connected} / ${rooms.length}`, 'Última ventana disponible', 'teal']]}/>
      <div className="sectionTitle"><h2>Distribución por piso</h2><span>Selecciona un piso o una sala para ver el detalle</span></div>
      <div className="floorStack">{floors.map(floor => {const floorRooms = rooms.filter(room => room.pisoId === floor.id);return <section className="floorSection" key={floor.id}><div className="floorSectionHead"><span className="floorIcon"><Grid2X2 size={21}/></span><div><h3>{floor.nombre}</h3><p>{floorRooms.length} salas · {count(floorRooms, room => data.states.find(state => state.salaId === room.id)?.nodoEstado === 'conectado')} nodos conectados</p></div><Link className="secondary compact" to={`/pisos/${floor.id}`}>Ver piso <ChevronRight size={16}/></Link></div><div className="floorRoomGrid">{floorRooms.map(room => <RoomTile key={room.id} room={room} state={data.states.find(state => state.salaId === room.id)} compact/>)}</div></section>})}</div>
    </>}
    {kind === 'floor' && <>
      <Summary cards={[["Salas monitorizadas", rooms.length, 'En este piso'], ["Condición óptima", good, 'Con dato completo', 'green'], ["Requieren atención", attention, 'Nivel 2 o superior', 'red'], ["Nodos conectados", `${connected} / ${rooms.length}`, 'Estado de conexión', 'teal']]}/>
      <div className="sectionTitle"><h2>Salas del piso</h2><span>{rooms.length} espacios disponibles</span></div>
      <div className="floorFilters"><label><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar sala"/></label><select aria-label="Filtrar por condición" value={filter} onChange={event => setFilter(event.target.value)}><option value="todos">Todos los estados</option><option value="optimo">Condición óptima</option><option value="atencion">Requiere atención</option><option value="insuficiente">Dato insuficiente</option></select></div>
      <div className="floorDetailedGrid">{rooms.filter(room => {const state = data.states.find(item => item.salaId === room.id); const matches = room.nombre.toLocaleLowerCase().includes(query.toLocaleLowerCase()); return matches && (filter === 'todos' || filter === 'optimo' && state?.icgScore === 0 || filter === 'atencion' && state?.icgScore >= 2 || filter === 'insuficiente' && state?.icgEstado !== 'completo');}).map(room => <RoomTile key={room.id} room={room} state={data.states.find(state => state.salaId === room.id)}/>)}</div>
    </>}
    {!rooms.length && <div className="panel"><p>Aún no hay salas monitorizadas en este espacio.</p></div>}
  </div>;
}
