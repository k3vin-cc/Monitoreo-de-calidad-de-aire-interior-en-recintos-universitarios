import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, KeyRound, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { api } from './services';
import { ROLE_LABEL } from './domain';

/** Nombre: PenpotUsers. Razón: administrar cuentas con guardado explícito y errores visibles.
 * Entradas: administrador actual y API. Salida: interfaz de Usuarios. Efectos: mutaciones confirmadas de cuentas. */
export default function PenpotUsers({
  currentUserId
}) {
  const [users, setUsers] = useState([]),
    [buildings, setBuildings] = useState([]);
  const [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [query, setQuery] = useState(''),
    [roleFilter, setRoleFilter] = useState(''),
    [stateFilter, setStateFilter] = useState('');
  const [modal, setModal] = useState(null),
    [dialogError, setDialogError] = useState(''),
    [pending, setPending] = useState('');
  const lock = useRef(false),
    generation = useRef(0);

  /** Nombre: reload. Razón: refrescar sin desmontar la tabla y consultar edificios sólo cuando se solicita.
   * Entradas: incluir edificios. Salida: estado actualizado. Efectos: sólo lecturas HTTP. */
  async function reload(includeBuildings = false) {
    const version = ++generation.current;
    setRefreshing(true);
    try {
      const [accounts, locations] = await Promise.all([api.users(), includeBuildings ? api.buildings() : Promise.resolve(null)]);
      if (version !== generation.current) return;
      setUsers(accounts);
      if (locations) setBuildings(locations);
      setError('');
    } catch (cause) {
      if (version === generation.current) setError(cause.message);
    } finally {
      if (version === generation.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }
  useEffect(() => {
    reload(true);
    return () => {
      generation.current++;
    };
  }, []);

  /** Nombre: openDialog. Razón: iniciar una acción con errores limpios.
   * Entradas: tipo y cuenta. Salida: diálogo visible. Efectos: ninguno persistente. */
  function openDialog(kind, user = null) {
    setDialogError('');
    setMessage('');
    setModal({
      kind,
      user
    });
  }
  /** Nombre: closeDialog. Razón: impedir cierre durante una escritura.
   * Entradas: ninguna. Salida: cierre disponible. Efectos: ninguno persistente. */
  function closeDialog() {
    if (!lock.current) {
      setModal(null);
      setDialogError('');
    }
  }

  /** Nombre: update. Razón: representar la cuenta devuelta por el servidor sin recargar toda la página.
   * Entradas: cuenta y campos. Salida: confirmación o error. Efectos: PATCH de cuenta. */
  async function update(user, patch) {
    if (lock.current || user.id === currentUserId) return;
    lock.current = true;
    setPending(user.id);
    setError('');
    setDialogError('');
    setMessage('');
    try {
      const saved = await api.patchUser(user.id, patch);
      setUsers(current => current.map(item => item.id === saved.id ? {
        ...item,
        ...saved
      } : item));
      setMessage(`Cambios guardados para ${user.nombre}.`);
      setModal(null);
    } catch (cause) {
      if (modal) setDialogError(cause.message);else setError(cause.message);
    } finally {
      lock.current = false;
      setPending('');
    }
  }
  /** Nombre: create. Razón: evitar envíos duplicados y conservar valores ante errores.
   * Entradas: formulario validado. Salida: confirmación o error local. Efectos: POST de cuenta. */
  async function create(event) {
    event.preventDefault();
    if (lock.current) return;
    const form = event.currentTarget;
    const body = {
      nombre: form.nombre.value.trim(),
      email: form.email.value.trim(),
      telefono: form.telefono.value.trim() || null,
      rol: form.rol.value,
      password: form.password.value,
      edificios: new FormData(form).getAll('edificios')
    };
    if (!body.nombre) {
      setDialogError('Escribe el nombre de la persona.');
      return;
    }
    lock.current = true;
    setPending('create');
    setDialogError('');
    setMessage('');
    try {
      await api.createUser(body);
      setModal(null);
      setMessage(`La cuenta ${body.email} quedó creada.`);
      await reload();
    } catch (cause) {
      setDialogError(cause.message);
    } finally {
      lock.current = false;
      setPending('');
    }
  }
  /** Nombre: removeUser. Razón: confirmar eliminación y conservar el diálogo si falla.
   * Entradas: cuenta seleccionada. Salida: confirmación o error. Efectos: DELETE de cuenta. */
  async function removeUser() {
    if (lock.current || !modal?.user || modal.user.id === currentUserId) return;
    const target = modal.user;
    lock.current = true;
    setPending(target.id);
    setDialogError('');
    setMessage('');
    try {
      await api.deleteUser(target.id);
      setUsers(current => current.filter(item => item.id !== target.id));
      setModal(null);
      setMessage(`Se eliminó la cuenta ${target.email} y se revocaron sus sesiones.`);
    } catch (cause) {
      setDialogError(cause.message);
    } finally {
      lock.current = false;
      setPending('');
    }
  }
  /** Nombre: submitEdit. Razón: validar confirmación de contraseña o permisos antes de guardar.
   * Entradas: formulario del diálogo. Salida: validación y envío. Efectos: delega PATCH a update. */
  function submitEdit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (modal.kind === 'buildings') {
      update(modal.user, {
        edificios: new FormData(form).getAll('edificios')
      });
      return;
    }
    if (form.password.value !== form.confirmPassword.value) {
      setDialogError('Las contraseñas no coinciden.');
      return;
    }
    update(modal.user, {
      password: form.password.value
    });
  }
  const stats = useMemo(() => ({
    active: users.filter(u => u.estado === 'activo').length,
    admins: users.filter(u => u.rol === 'ADMIN').length,
    activeAdmins: users.filter(u => u.rol === 'ADMIN' && u.estado === 'activo').length
  }), [users]);
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return users.filter(user => (!roleFilter || user.rol === roleFilter) && (!stateFilter || user.estado === stateFilter) && `${user.nombre} ${user.email}`.toLocaleLowerCase().includes(term));
  }, [users, query, roleFilter, stateFilter]);
  const disabled = Boolean(pending) || loading || refreshing;
  const titles = {
    create: 'Crear usuario',
    buildings: 'Edificios autorizados',
    password: 'Restablecer contraseña',
    delete: 'Eliminar cuenta'
  };
  return <div className="penpotUsers">
    <div className="pageHeading"><div><span className="eyebrow">ADMINISTRACIÓN / 10</span><h1>Gestión de usuarios</h1><p>Administra cuentas, roles y acceso a los edificios del campus.</p></div><button className="primary" disabled={disabled} onClick={() => openDialog('create')}><Plus size={17} />Crear usuario</button></div>
    <div aria-live="polite" aria-atomic="true">{message && <div className="notice success usersNotice"><Check size={17} />{message}</div>}</div>
    {error && <div role="alert" className="notice error usersNotice"><CircleAlert size={17} />{error}</div>}
    <div className="usersSummary"><article className="statCard"><span>Usuarios registrados</span><strong>{users.length}</strong><small>Total de cuentas</small></article><article className="statCard green"><span>Cuentas activas</span><strong>{stats.active}</strong><small>Con acceso al sistema</small></article><article className="statCard"><span>Administradores</span><strong>{stats.admins}</strong><small>{stats.activeAdmins} activos</small></article></div>
    <section className="panel usersTablePanel" aria-busy={loading || refreshing}><div className="panelHead"><div><h2>Cuentas del sistema</h2><p>Roles y permisos de cada persona</p></div><button className="secondary compact" disabled={disabled} onClick={() => reload(true)}><RefreshCw size={16} className={refreshing ? 'spin' : ''} />{refreshing ? 'Actualizando…' : 'Actualizar'}</button></div>
      <div className="usersFilters"><label><Search size={17} /><input aria-label="Buscar por nombre o correo" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar nombre o correo" /></label><select aria-label="Filtrar por rol" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}><option value="">Todos los roles</option>{['ADMIN', 'ANALISTA', 'VIEWER', 'GUEST'].map(role => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}</select><select aria-label="Filtrar por estado" value={stateFilter} onChange={e => setStateFilter(e.target.value)}><option value="">Todos los estados</option><option value="activo">Activo</option><option value="inactivo">Inactivo</option></select>{(query || roleFilter || stateFilter) && <button className="secondary compact" onClick={() => {
          setQuery('');
          setRoleFilter('');
          setStateFilter('');
        }}>Limpiar filtros</button>}</div>
      <p className="usersResultCount" role="status">{loading ? 'Cargando cuentas…' : `${filtered.length} de ${users.length} cuentas`}</p>
      {!loading && <div className="tableScroll"><table><thead><tr><th scope="col">Usuario</th><th scope="col">Rol</th><th scope="col">Estado</th><th scope="col">Edificios autorizados</th><th scope="col">Acciones</th></tr></thead><tbody>{filtered.map(user => <UserRow key={user.id} user={user} buildings={buildings} currentUserId={currentUserId} isLastActiveAdmin={user.rol === 'ADMIN' && user.estado === 'activo' && stats.activeAdmins === 1} disabled={disabled} pending={pending === user.id} onUpdate={update} onOpen={openDialog} />)}</tbody></table>{!filtered.length && <div className="empty"><b>{users.length ? 'No hay cuentas que coincidan' : 'No hay cuentas disponibles'}</b><span>{users.length ? 'Prueba otro nombre, correo o filtro.' : 'Actualiza la lista o crea una cuenta.'}</span></div>}</div>}
    </section>
    {modal && <UserDialog title={titles[modal.kind]} pending={Boolean(pending)} onClose={closeDialog}>
      {modal.user && <div className="usersTarget"><b>{modal.user.nombre}</b><span>{modal.user.email}</span></div>}
      {dialogError && <div className="notice error usersNotice" role="alert"><CircleAlert size={17} />{dialogError}</div>}
      {modal.kind === 'create' && <CreateUserForm buildings={buildings} pending={Boolean(pending)} onSubmit={create} onCancel={closeDialog} />}
      {modal.kind === 'buildings' && <form className="stack" onSubmit={submitEdit}><p className="helper">Selecciona los edificios que podrá consultar. Los cambios se aplican al guardar.</p><BuildingChoices buildings={buildings} assigned={modal.user.assignedEdificios || []} disabled={Boolean(pending)} /><DialogActions pending={Boolean(pending)} onCancel={closeDialog} label="Guardar permisos" /></form>}
      {modal.kind === 'password' && <form className="stack" onSubmit={submitEdit}><p className="helper">Al guardar se revocarán las sesiones de esta cuenta.</p><label>Nueva contraseña<input name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password" disabled={Boolean(pending)} /></label><label>Confirmar contraseña<input name="confirmPassword" type="password" minLength={12} maxLength={128} required autoComplete="new-password" disabled={Boolean(pending)} /></label><small>Entre 12 y 128 caracteres.</small><DialogActions pending={Boolean(pending)} onCancel={closeDialog} label="Guardar contraseña" /></form>}
      {modal.kind === 'delete' && <><p>Se eliminará la cuenta y se revocarán sus sesiones. Las mediciones y alertas históricas se conservarán.</p><div className="dialogActions"><button className="secondary" disabled={Boolean(pending)} onClick={closeDialog}>Cancelar</button><button className="primary dangerButton" disabled={Boolean(pending)} onClick={removeUser}><Trash2 size={17} />{pending ? 'Eliminando…' : 'Eliminar cuenta'}</button></div></>}
    </UserDialog>}
  </div>;
}

/** Nombre: UserDialog. Razón: usar modalidad y contención de foco nativas del navegador.
 * Entradas: título, contenido y bloqueo. Salida: diálogo accesible. Efectos: bloqueo temporal de scroll y retorno de foco. */
function UserDialog({
  title,
  children,
  pending,
  onClose
}) {
  const ref = useRef(null);
  useEffect(() => {
    const opener = document.activeElement,
      overflow = document.body.style.overflow;
    const dialog = ref.current;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return <dialog ref={ref} className="usersModal" aria-labelledby="users-dialog-title" aria-busy={pending} onCancel={event => {
    event.preventDefault();
    if (!pending) onClose();
  }}><div className="panelHead"><h2 id="users-dialog-title">{title}</h2><button type="button" className="iconBtn" aria-label="Cerrar diálogo" disabled={pending} onClick={onClose}><X size={21} /></button></div>{children}</dialog>;
}
/** Nombre: BuildingChoices. Razón: selección táctil explícita de permisos.
 * Entradas: edificios y asignaciones iniciales. Salida: casillas de formulario. Efectos: ninguno persistente. */
function BuildingChoices({
  buildings,
  assigned = [],
  disabled
}) {
  return <fieldset className="usersBuildingChoices" disabled={disabled}><legend>Edificios autorizados</legend>{buildings.length ? buildings.map(building => <label key={building.id}><input type="checkbox" name="edificios" value={building.id} defaultChecked={assigned.includes(building.id)} /><span>{building.nombre}</span></label>) : <p>No hay edificios disponibles.</p>}<small>Sin edificios asignados, la cuenta no podrá consultar espacios.</small></fieldset>;
}
/** Nombre: DialogActions. Razón: representar guardado pendiente.
 * Entradas: bloqueo, cancelar y etiqueta. Salida: acciones de formulario. Efectos: envío o cancelación por el padre. */
function DialogActions({
  pending,
  onCancel,
  label
}) {
  return <div className="dialogActions"><button type="button" className="secondary" disabled={pending} onClick={onCancel}>Cancelar</button><button type="submit" className="primary" disabled={pending}><Check size={17} />{pending ? 'Guardando…' : label}</button></div>;
}
/** Nombre: CreateUserForm. Razón: validar alta y explicar permisos.
 * Entradas: edificios, bloqueo y callbacks. Salida: formulario. Efectos: delega creación al padre. */
function CreateUserForm({
  buildings,
  pending,
  onSubmit,
  onCancel
}) {
  const [role, setRole] = useState('VIEWER');
  return <form className="stack" onSubmit={onSubmit}><fieldset className="usersFormFields" disabled={pending}><div className="formGrid"><label>Nombre<input name="nombre" required maxLength={100} autoComplete="name" /></label><label>Correo institucional<input name="email" type="email" required maxLength={100} autoComplete="email" /></label><label>Teléfono <small>(opcional)</small><input name="telefono" type="tel" maxLength={20} autoComplete="tel" /></label><label>Rol<select name="rol" value={role} onChange={e => setRole(e.target.value)}>{['VIEWER', 'ANALISTA', 'ADMIN'].map(value => <option key={value} value={value}>{ROLE_LABEL[value]}</option>)}</select></label><label className="usersFullWidth">Contraseña inicial<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /><small>Entre 12 y 128 caracteres.</small></label></div>{role === 'ADMIN' ? <p className="usersAccessNote">Administrador tendrá acceso a todos los edificios.</p> : <BuildingChoices buildings={buildings} />}</fieldset><DialogActions pending={pending} onCancel={onCancel} label="Crear cuenta" /></form>;
}
/** Nombre: UserRow. Razón: mostrar permisos guardados sin guardado por pérdida de foco.
 * Entradas: cuenta, edificios y acciones. Salida: fila. Efectos: delega modificaciones al padre. */
function UserRow({
  user,
  buildings,
  currentUserId,
  isLastActiveAdmin,
  disabled,
  pending,
  onUpdate,
  onOpen
}) {
  const own = user.id === currentUserId;
  const names = (user.assignedEdificios || []).map(id => buildings.find(b => b.id === id)?.nombre || 'Edificio no disponible');
  return <tr aria-busy={pending}><td><b>{user.nombre}</b><small className="block">{user.email}</small>{own && <small className="currentUserNote">Cuenta actual · protegida</small>}</td><td><select disabled={disabled || own || isLastActiveAdmin} aria-label={`Rol de ${user.nombre}`} value={user.rol} onChange={e => onUpdate(user, {
        rol: e.target.value
      })}>{['ADMIN', 'ANALISTA', 'VIEWER'].map(role => <option value={role} key={role}>{ROLE_LABEL[role]}</option>)}{user.rol === 'GUEST' && <option value="GUEST" disabled>Invitado (legado)</option>}</select></td><td><span className={`badge ${user.estado === 'activo' ? 'good' : 'muted'}`}>{user.estado === 'activo' ? 'Activo' : 'Inactivo'}</span>{pending && <small role="status" className="block">Guardando…</small>}</td><td>{user.rol === 'ADMIN' ? <span className="badge infoBadge">Acceso total</span> : <><span className="usersBuildingNames">{names.join(', ') || 'Sin edificios asignados'}</span><button className="secondary compact" disabled={disabled || own} onClick={() => onOpen('buildings', user)}>Editar edificios</button></>}</td><td>{own ? <span className="currentUserNote">Gestiona tus datos en Mi perfil</span> : <div className="rowActions"><button className="secondary compact" disabled={disabled || isLastActiveAdmin} title={isLastActiveAdmin ? 'Debe permanecer un administrador activo' : ''} onClick={() => onUpdate(user, {
          estado: user.estado === 'activo' ? 'inactivo' : 'activo'
        })}>{user.estado === 'activo' ? 'Desactivar' : 'Activar'}</button><button className="iconBtn" disabled={disabled} aria-label={`Restablecer contraseña de ${user.nombre}`} title="Restablecer contraseña" onClick={() => onOpen('password', user)}><KeyRound size={17} /></button><button className="iconBtn dangerIcon" disabled={disabled || isLastActiveAdmin} aria-label={`Eliminar a ${user.nombre}`} title={isLastActiveAdmin ? 'Debe permanecer un administrador activo' : 'Eliminar cuenta'} onClick={() => onOpen('delete', user)}><Trash2 size={17} /></button></div>}</td></tr>;
}
