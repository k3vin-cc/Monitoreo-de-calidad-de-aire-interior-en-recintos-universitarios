const API_BASE = '/api';
let accessToken = sessionStorage.getItem('aira.accessToken') || '';
const listeners = new Set();
let refreshInFlight = null;
export const session = {
  get token(){return accessToken;},
  set(token,user,expiresIn){
    const next=token||'';
    const sameToken=next===accessToken;
    accessToken=next;
    if(accessToken)sessionStorage.setItem('aira.accessToken',accessToken);else sessionStorage.removeItem('aira.accessToken');
    if(user)sessionStorage.setItem('aira.user',JSON.stringify(user));else if(!accessToken)sessionStorage.removeItem('aira.user');
    if(Number.isFinite(expiresIn)&&expiresIn>0)sessionStorage.setItem('aira.expiresAt',String(Date.now()+expiresIn*1000));
    else if(!accessToken)sessionStorage.removeItem('aira.expiresAt');
    else if(!sameToken)sessionStorage.removeItem('aira.expiresAt');
    listeners.forEach(fn=>fn());
  },
  get user(){try{return JSON.parse(sessionStorage.getItem('aira.user')||'null')}catch{return null}},
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)}
};
async function request(path, options={}) {
  const headers = new Headers(options.headers || {});
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type','application/json');
  const firmwareDownload = path.startsWith('/firmwares/') && path.endsWith('/descarga');
  const send=()=>fetch(`${API_BASE}${path}`,{...options,headers:new Headers(headers),credentials:'include',cache:firmwareDownload?'no-store':options.cache});
  let response = await send();
  const authPath=path.startsWith('/auth/');
  if(response.status===401&&!authPath&&accessToken){
    try{await renewAccessToken();headers.set('Authorization',`Bearer ${accessToken}`);response=await send()}
    catch(error){if(error.status===401||error.status===403)session.set('',null);throw error}
    if(response.status===401)session.set('',null);
  }
  if (response.status === 204) return null;
  if (!response.ok) { let message=`Error ${response.status}`;try{const body=await response.json();message=body.detail||body.message||message}catch{} const err=new Error(message);err.status=response.status;throw err; }
  const type=response.headers.get('content-type')||'';
  return type.includes('application/json') ? response.json() : response.blob();
}
async function renewAccessToken(){
  if(!refreshInFlight)refreshInFlight=(async()=>{
    const response=await fetch(`${API_BASE}/auth/renovar`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'include'});
    let body={};try{body=await response.json()}catch{}
    if(!response.ok){const error=new Error(body.detail||body.message||`Error ${response.status}`);error.status=response.status;throw error}
    session.set(body.accessToken,session.user,body.expiresIn);
    return body;
  })().finally(()=>{refreshInFlight=null});
  return refreshInFlight;
}
const query = params => {const q=new URLSearchParams();Object.entries(params||{}).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')q.set(k,String(v))});const s=q.toString();return s?`?${s}`:''};
export const api = {
  request,
  campus: ()=>request('/campus'),
  login: body=>request('/auth/login',{method:'POST',body:JSON.stringify(body)}),
  guestLogin: ()=>request('/auth/invitado',{method:'POST'}),
  logout: ()=>request('/auth/logout',{method:'POST'}),
  renew: ()=>renewAccessToken(),
  profile: ()=>request('/perfil'), updateProfile: body=>request('/perfil',{method:'PATCH',body:JSON.stringify(body)}),
  sectors: (options={})=>request('/sectores'+query({incluirConteosHistorial:false,...options})), createSector:body=>request('/sectores',{method:'POST',body:JSON.stringify(body)}), patchSector:(id,body)=>request(`/sectores/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)}), deleteSector:(id,body={})=>request(`/sectores/${encodeURIComponent(id)}`,{method:'DELETE',body:JSON.stringify(body)}),
  buildings: (sectorId,options={})=>request('/edificios'+query({incluirConteosHistorial:false,sectorId,...options})), createBuilding:body=>request('/edificios',{method:'POST',body:JSON.stringify(body)}), patchBuilding:(id,body)=>request(`/edificios/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)}), deleteBuilding:(id,body={})=>request(`/edificios/${encodeURIComponent(id)}`,{method:'DELETE',body:JSON.stringify(body)}),
  floors: (buildingId,options={})=>request('/pisos'+query({incluirConteosHistorial:false,edificioId:buildingId,...options})), createFloor:body=>request('/pisos',{method:'POST',body:JSON.stringify(body)}), patchFloor:(id,body)=>request(`/pisos/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)}), deleteFloor:(id,body={})=>request(`/pisos/${encodeURIComponent(id)}`,{method:'DELETE',body:JSON.stringify(body)}),
  rooms: (params={},options={})=>request('/salas'+query({incluirConteosHistorial:false,...params,...options})), createRoom:body=>request('/salas',{method:'POST',body:JSON.stringify(body)}), patchRoom:(id,body)=>request(`/salas/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)}), deleteRoom:(id,body={})=>request(`/salas/${encodeURIComponent(id)}`,{method:'DELETE',body:JSON.stringify(body)}),
  state: id=>request(`/salas/${encodeURIComponent(id)}/estado`), telemetry:(id,params)=>request(`/salas/${encodeURIComponent(id)}/telemetria${query(params)}`),
  exportRoom:(id,format,params)=>request(`/salas/${encodeURIComponent(id)}/exportacion${query({formato:format,...params})}`),
  alerts:params=>request('/alertas'+query(params)), nodes: (options={})=>request('/nodos'+query({incluirConteosHistorial:false,...options})),
  /** Nombre: nodeRetirementSummary. Razón: obtiene el historial sólo al abrir el diálogo de retiro. Entradas: id del nodo seleccionado. Salida: conteos históricos del nodo. Efectos: ninguno; consulta la API. */
  nodeRetirementSummary:id=>request(`/nodos/${encodeURIComponent(id)}/resumen-retiro`), nodeProvisioning:id=>request(`/nodos/${encodeURIComponent(id)}/aprovisionamiento`), createNode:body=>request('/nodos',{method:'POST',body:JSON.stringify(body)}), patchNode:(id,body)=>request(`/nodos/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)}), deleteNode:(id,body={})=>request(`/nodos/${encodeURIComponent(id)}`,{method:'DELETE',body:JSON.stringify(body)}), assignNode:(id,salaId)=>request(`/nodos/${encodeURIComponent(id)}/asignacion`,{method:'PATCH',body:JSON.stringify({salaId})}),
  firmwares:orden=>request('/firmwares'+query({orden})), uploadFirmware:form=>request('/firmwares',{method:'POST',body:form}), downloadFirmware:id=>request(`/firmwares/${encodeURIComponent(id)}/descarga`), patchFirmware:(id,body)=>request(`/firmwares/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)}), deleteFirmware:id=>request(`/firmwares/${encodeURIComponent(id)}`,{method:'DELETE'}), flashRecord:(nodeId,firmwareId,extra={})=>request(`/nodos/${encodeURIComponent(nodeId)}/firmware`,{method:'PATCH',body:JSON.stringify({firmwareId,...extra})}),
  users:()=>request('/usuarios'), createUser:body=>request('/usuarios',{method:'POST',body:JSON.stringify(body)}), patchUser:(id,body)=>request(`/usuarios/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)}), deleteUser:id=>request(`/usuarios/${encodeURIComponent(id)}`,{method:'DELETE'}),
  telegramLink:()=>request('/telegram/vinculo',{method:'POST'}), telegramPrefs:()=>request('/telegram/preferencias'), saveTelegram:body=>request('/telegram/preferencias',{method:'PUT',body:JSON.stringify(body)})
};

let socket; let reconnectTimer; let stopped=false; let connectionStatus='disconnected';
const eventListeners=new Set();
const statusListeners=new Set();
/**
 * Nombre   : updateLiveStatus
 * Razón    : Mantiene sincronizado el estado visible de la conexión WebSocket.
 * Entradas : next - estado de conexión que informa el ciclo del socket.
 * Salida   : Ninguna.
 * Efectos  : Notifica a los componentes suscritos; no modifica datos persistentes.
 */
function updateLiveStatus(next){connectionStatus=next;statusListeners.forEach(fn=>fn(next))}
export const live = {
  get status(){return connectionStatus;},
  subscribe(fn){eventListeners.add(fn);return()=>eventListeners.delete(fn)},
  subscribeStatus(fn){statusListeners.add(fn);fn(connectionStatus);return()=>statusListeners.delete(fn)},
  connect(){stopped=false;if(!session.token){updateLiveStatus('disconnected');return}clearTimeout(reconnectTimer);try{updateLiveStatus('connecting');const scheme=location.protocol==='https:'?'wss:':'ws:';const current=new WebSocket(`${scheme}//${location.host}/ws?token=${encodeURIComponent(session.token)}`);socket=current;current.onopen=()=>{if(socket===current)updateLiveStatus('connected')};current.onmessage=event=>{try{const data=JSON.parse(event.data);eventListeners.forEach(fn=>fn(data))}catch{}};current.onclose=event=>{if(socket!==current)return;socket=null;if(stopped||!session.token){updateLiveStatus('disconnected');return}if(event.code===4401){renewAccessToken().catch(()=>session.set('',null));return}updateLiveStatus('reconnecting');reconnectTimer=setTimeout(()=>live.connect(),2500)};current.onerror=()=>{if(socket===current)updateLiveStatus('disconnected')}}catch{updateLiveStatus('disconnected');if(session.token)reconnectTimer=setTimeout(()=>live.connect(),2500)}},
  close(){stopped=true;clearTimeout(reconnectTimer);const current=socket;socket=null;current?.close();updateLiveStatus('disconnected')}
};
session.subscribe(()=>{live.close();if(session.token)live.connect()});
