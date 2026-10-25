import React, { useEffect, useMemo, useState } from 'react';
import { Check, CircleAlert, KeyRound, Plus, RefreshCw, Search, Trash2, Users, X } from 'lucide-react';
import { api } from './services';
import { ROLE_LABEL } from './domain';

export default function PenpotUsers({ currentUserId }) {
  const [users, setUsers] = useState([]);
  const [buildings, setBuildings] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  async function reload() {
    setBusy(true);
    try {
      const [accounts, locations] = await Promise.all([api.users(), api.buildings()]);
      setUsers(accounts); setBuildings(locations); setError('');
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  useEffect(() => { reload(); }, []);
  async function create(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = { nombre: form.nombre.value, email: form.email.value, telefono: form.telefono.value || null, rol: form.rol.value, password: form.password.value, edificios: [...form.edificios.selectedOptions].map(option => option.value) };
    try {
      await api.createUser(body);
      setOpen(false); setMessage(`La cuenta ${body.email} quedó creada.`); setError('');
      await reload();
    } catch (cause) { setError(cause.message); }
  }
  async function update(id, patch) {
    if (id === currentUserId) { setError('No puedes editar la cuenta de administrador que estás usando.'); return; }
    try { await api.patchUser(id, patch); setError(''); await reload(); }
    catch (cause) { setError(cause.message); }
  }
  async function removeUser() {
    if (!deleteTarget || deleteTarget.id === currentUserId) return;
    try {
      await api.deleteUser(deleteTarget.id);
      setMessage(`Se eliminó la cuenta ${deleteTarget.email} y se revocaron sus sesiones.`);
      setError(''); setDeleteTarget(null); await reload();
    } catch (cause) { setError(cause.message); setDeleteTarget(null); }
  }
  const filtered = useMemo(() => users.filter(user => (!roleFilter || user.rol === roleFilter) && `${user.nombre} ${user.email}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [users, query, roleFilter]);
  const active = users.filter(user => user.estado === 'activo').length;

  return <div className="penpotUsers">
    <div className="pageHeading"><div><span className="eyebrow">ADMINISTRACIÓN / 10</span><h1>Gestión de usuarios</h1><p>Administra cuentas, roles institucionales y espacios autorizados.</p></div><button className="primary" onClick={()=>setOpen(true)}><Plus size={17}/> Crear usuario</button></div>
    {message && <div className="notice success usersNotice"><Check size={16}/>{message}</div>}
    {error && <div className="notice error usersNotice"><CircleAlert size={16}/>{error}</div>}
    <section className="panel usersTablePanel"><div className="panelHead"><div><h2>Cuentas del sistema</h2><p>{users.length} usuarios registrados</p></div><button className="iconBtn" title="Actualizar cuentas" onClick={reload}><RefreshCw size={17}/></button></div><div className="usersFilters"><label><Search size={16}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar por nombre o correo"/></label><select aria-label="Filtrar por rol" value={roleFilter} onChange={event=>setRoleFilter(event.target.value)}><option value="">Todos los roles</option>{['ADMIN','ANALISTA','VIEWER','GUEST'].map(role=><option key={role} value={role}>{ROLE_LABEL[role]}</option>)}</select></div>
      {busy ? <div className="loading">Cargando usuarios…</div> : <div className="tableScroll"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Edificios autorizados</th><th>Acciones</th></tr></thead><tbody>{filtered.map(user=><UserRow key={user.id} user={user} buildings={buildings} currentUserId={currentUserId} isLastActiveAdmin={user.rol==='ADMIN'&&user.estado==='activo'&&users.filter(item=>item.rol==='ADMIN'&&item.estado==='activo').length===1} onUpdate={update} onDelete={setDeleteTarget}/>)}</tbody></table>{!filtered.length && <div className="empty"><b>Sin usuarios para estos filtros</b></div>}</div>}</section>
    <div className="usersSummary"><article className="statCard"><span>Usuarios registrados</span><strong>{users.length}</strong><small>Total de cuentas</small></article><article className="statCard green"><span>Cuentas activas</span><strong>{active}</strong><small>Con acceso al sistema</small></article><article className="statCard"><span>Administradores</span><strong>{users.filter(user=>user.rol==='ADMIN').length}</strong><small>Con permisos de gestión</small></article></div>
    <div className="usersInfo"><Users size={21}/><div><b>Acceso controlado por rol y ubicación</b><span>Los administradores pueden crear cuentas y modificar los edificios autorizados. Cada persona accede con sus propias credenciales.</span></div></div>
    {open && <div className="dialogBackdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setOpen(false)}}><section className="userDialog" role="dialog" aria-modal="true" aria-label="Crear usuario"><div className="panelHead"><div><span className="eyebrow">ADMINISTRACIÓN</span><h2>Crear usuario</h2></div><button className="iconBtn" onClick={()=>setOpen(false)} aria-label="Cerrar"><X size={20}/></button></div><p className="helper">La contraseña inicial debe tener al menos 12 caracteres.</p><form className="stack" onSubmit={create}><div className="formGrid"><label>Nombre<input name="nombre" required maxLength="100"/></label><label>Correo institucional<input name="email" type="email" required/></label><label>Teléfono<input name="telefono" type="tel"/></label><label>Rol<select name="rol" defaultValue="VIEWER">{['VIEWER','ANALISTA','ADMIN'].map(role=><option key={role} value={role}>{ROLE_LABEL[role]}</option>)}</select></label><label>Contraseña inicial<input name="password" type="password" minLength="12" autoComplete="new-password" required/></label><label>Edificios autorizados<select name="edificios" multiple size="4">{buildings.map(building=><option key={building.id} value={building.id}>{building.nombre}</option>)}</select></label></div><div className="dialogActions"><button type="button" className="secondary" onClick={()=>setOpen(false)}>Cancelar</button><button className="primary"><Plus size={16}/>Crear cuenta</button></div></form></section></div>}
    {deleteTarget && <div className="dialogBackdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setDeleteTarget(null)}}><section className="userDialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-user-title"><div className="panelHead"><div><span className="eyebrow">CONFIRMACIÓN</span><h2 id="delete-user-title">¿Eliminar esta cuenta?</h2></div><button className="iconBtn" onClick={()=>setDeleteTarget(null)} aria-label="Cerrar"><X size={20}/></button></div><div className="stack"><div className="readOnly"><b>{deleteTarget.nombre}</b><span>{deleteTarget.email}</span><span>Rol: {ROLE_LABEL[deleteTarget.rol]}</span></div><p>Se eliminará la cuenta y se revocarán sus sesiones activas. Las mediciones y alertas históricas no se borrarán.</p><div className="dialogActions"><button className="secondary" onClick={()=>setDeleteTarget(null)}>Cancelar</button><button className="primary dangerButton" onClick={removeUser}><Trash2 size={16}/>Eliminar cuenta</button></div></div></section></div>}
  </div>;
}

function UserRow({ user, buildings, currentUserId, isLastActiveAdmin, onUpdate, onDelete }) {
  const [assigned, setAssigned] = useState(user.assignedEdificios || []);
  const isCurrentUser = user.id === currentUserId;
  useEffect(()=>setAssigned(user.assignedEdificios || []),[user.assignedEdificios]);
  return <tr><td><b>{user.nombre}</b><small className="block">{user.email}</small>{isCurrentUser&&<small className="currentUserNote">Cuenta actual · protegida</small>}</td><td><select disabled={isCurrentUser||isLastActiveAdmin} aria-label={`Rol de ${user.email}`} value={user.rol} onChange={event=>onUpdate(user.id,{rol:event.target.value})}>{['ADMIN','ANALISTA','VIEWER',...(user.rol==='GUEST'?['GUEST']:[])].map(role=><option value={role} key={role}>{ROLE_LABEL[role]}</option>)}</select></td><td><span className={`badge ${user.estado === 'activo' ? 'good' : 'muted'}`}>{user.estado}</span></td><td>{user.rol === 'ADMIN' ? <span className="badge infoBadge">Acceso total</span> : <select disabled={isCurrentUser} aria-label={`Edificios de ${user.email}`} multiple size="2" value={assigned} onChange={event=>setAssigned([...event.target.selectedOptions].map(option=>option.value))} onBlur={()=>{if(JSON.stringify(assigned)!==JSON.stringify(user.assignedEdificios||[]))onUpdate(user.id,{edificios:assigned})}}>{buildings.map(building=><option key={building.id} value={building.id}>{building.nombre}</option>)}</select>}</td><td>{isCurrentUser?<span className="currentUserNote">Sin acciones disponibles</span>:<div className="rowActions"><button className="secondary compact" disabled={isLastActiveAdmin} title={isLastActiveAdmin?'Debe permanecer al menos un administrador activo':''} onClick={()=>onUpdate(user.id,{estado:user.estado==='activo'?'inactivo':'activo'})}>{user.estado==='activo'?'Desactivar':'Activar'}</button><button className="iconBtn" title="Restablecer contraseña" onClick={()=>{const password=prompt('Nueva contraseña (mínimo 12 caracteres):');if(password&&password.length>=12)onUpdate(user.id,{password})}}><KeyRound size={16}/></button><button className="iconBtn dangerIcon" title="Eliminar usuario" aria-label={`Eliminar a ${user.nombre}`} onClick={()=>onDelete(user)} disabled={isLastActiveAdmin}><Trash2 size={17}/></button></div>}</td></tr>;
}
