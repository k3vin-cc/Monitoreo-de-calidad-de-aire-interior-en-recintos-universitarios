import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CircleAlert, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { api, session } from './services';

export default function PenpotLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    try {
      const result = await api.login({ email: form.email.value, password: form.password.value });
      session.set(result.accessToken, result.usuario, result.expiresIn);
      const profile = await api.profile();
      session.set(session.token, profile);
      navigate(location.state?.from || '/dashboard', { replace: true });
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function enterAsGuest() {
    setBusy(true);
    setError('');
    try {
      const result = await api.guestLogin();
      session.set(result.accessToken, result.usuario, result.expiresIn);
      const profile = await api.profile();
      session.set(session.token, profile);
      navigate('/dashboard', { replace: true });
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="penpotLogin">
    <section className="loginIllustration" aria-label="AIRA, monitoreo ambiental universitario">
      <div className="illustrationTop"><div className="illustrationWordmark">AIRA<span>.</span></div><span>MONITOREO AMBIENTAL</span></div>
      <div className="illustrationContent">
        <span className="illustrationEyebrow">MONITOREO AMBIENTAL INTELIGENTE</span>
        <h1>Espacios más sanos,<br/>decisiones mejor<br/>informadas<span>.</span></h1>
        <p>Conoce en tiempo real la calidad del aire de los espacios universitarios y actúa con información confiable.</p>
        <div className="campusArtwork" aria-hidden="true">
          <div className="artMoon"/><div className="artCloud artCloudOne"/><div className="artCloud artCloudTwo"/>
          <div className="artBuilding artBuildingOne"><i/><i/><i/><i/><i/><i/></div>
          <div className="artBuilding artBuildingTwo"><i/><i/><i/><i/><i/><i/><i/><i/><i/></div>
          <div className="artBuilding artBuildingThree"><i/><i/><i/><i/></div>
          <div className="artTree artTreeOne"/><div className="artTree artTreeTwo"/>
          <div className="artGround"/>
        </div>
      </div>
      <div className="illustrationBottom">Una plataforma para cuidar a nuestra comunidad.</div>
    </section>
    <section className="loginFormSide">
      <div className="loginFormWrap">
        <span className="loginAccessTag"><ShieldCheck size={15}/> ACCESO INSTITUCIONAL</span>
        <h2>Bienvenido a AIRA</h2>
        <p className="loginIntro">Ingresa con las credenciales de tu cuenta universitaria.</p>
        <form onSubmit={submit} className="loginFields">
          <label htmlFor="loginEmail">Correo institucional</label>
          <div className="loginInput"><Mail size={18}/><input id="loginEmail" name="email" type="email" autoComplete="username" placeholder="nombre@example.org" required/></div>
          <label htmlFor="loginPassword">Contraseña</label>
          <div className="loginInput"><LockKeyhole size={18}/><input id="loginPassword" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Ingresa tu contraseña" required/><button type="button" onClick={()=>setShowPassword(value=>!value)} aria-label={showPassword?'Ocultar contraseña':'Mostrar contraseña'}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>
          <p className="loginHint">Tu sesión está protegida y es de uso personal.</p>
          {error && <div className="notice error"><CircleAlert size={17}/>{error}</div>}
          <button className="loginSubmit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={19}/> : <>Iniciar sesión <ArrowRight size={20}/></>}</button>
        </form>
        <div className="loginDivider"/>
        <button type="button" className="guestLogin" onClick={enterAsGuest} disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={17}/> : <Eye size={17}/>} Ingresar como invitado
        </button>
        <p className="guestLoginHint">Consulta el estado actual de todos los edificios y espacios. No requiere cuenta.</p>
        <p className="loginHelp"><strong>¿Necesitas acceso?</strong><br/>Solicita una cuenta al administrador de tu unidad.</p>
      </div>
      <div className="loginSideFooter">© {new Date().getFullYear()} Plataforma AIRA</div>
    </section>
  </main>;
}
