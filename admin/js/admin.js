'use strict';

/* ============================================================
   El Observador — Panel de administración
   JavaScript vanilla, sin frameworks, sin build step.
   Consume la API bajo /api/admin/... documentada en CONTRATO.md.
   ============================================================ */

// ---------- Constantes ----------

const CLAVE_TOKEN = 'sb_admin_token';
const CLAVE_USUARIO = 'sb_admin_usuario';

// Lista fija de categorías, tal como la expone services/categorizador.js
const CATEGORIAS = ['Policial', 'Político', 'Deportivo', 'General'];

const ETIQUETAS_POSICION = {
  header: 'Header',
  sidebar: 'Sidebar',
  'entre-noticias': 'Entre noticias',
  footer: 'Footer',
};

// ---------- Estado en memoria ----------

const estadoNoticias = { pagina: 1, buscar: '', categoria: '', fuente: '' };
let cacheNoticias = new Map();
let cacheFuentes = new Map();
let cachePublicidades = new Map();
let configCache = {};
let ultimoPorDia = [];
let feedValidado = false;

// ============================================================
// Utilidades generales
// ============================================================

function escaparHtml(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatearFecha(iso) {
  if (!iso) return '—';
  const fecha = new Date(iso);
  if (isNaN(fecha.getTime())) return String(iso);
  return fecha.toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatearFechaCorta(iso) {
  if (!iso) return '—';
  const fecha = new Date(iso);
  if (isNaN(fecha.getTime())) return String(iso).slice(0, 10);
  return fecha.toLocaleDateString('es-AR');
}

function formatearVigencia(inicio, fin) {
  if (!inicio && !fin) return 'Sin límite';
  return `${inicio ? formatearFechaCorta(inicio) : '—'} al ${fin ? formatearFechaCorta(fin) : '—'}`;
}

function calcularCtr(impresiones, clicks) {
  const imp = Number(impresiones) || 0;
  const cl = Number(clicks) || 0;
  if (imp <= 0) return '0%';
  return `${((cl / imp) * 100).toFixed(2)}%`;
}

function debounce(fn, espera) {
  let temporizador;
  return (...args) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => fn(...args), espera);
  };
}

// Normaliza una respuesta que puede venir como arreglo plano o envuelta
// en un objeto (p. ej. { fuentes: [...] }), para no acoplarse de más a
// un detalle de formato del backend que el contrato no fija con precisión.
function comoArreglo(valor, ...claves) {
  if (Array.isArray(valor)) return valor;
  if (valor && typeof valor === 'object') {
    for (const clave of claves) {
      if (Array.isArray(valor[clave])) return valor[clave];
    }
  }
  return [];
}

// ============================================================
// Cliente HTTP contra /api/admin/...
// ============================================================

async function apiFetch(ruta, opciones = {}) {
  const token = localStorage.getItem(CLAVE_TOKEN);
  const cabeceras = Object.assign({ 'Content-Type': 'application/json' }, opciones.headers || {});
  if (token) cabeceras['Authorization'] = `Bearer ${token}`;

  let respuesta;
  try {
    respuesta = await fetch(ruta, Object.assign({}, opciones, { headers: cabeceras }));
  } catch (err) {
    throw new Error('No se pudo conectar con el servidor. Verificá tu conexión.');
  }

  let cuerpo = null;
  const tipoContenido = respuesta.headers.get('content-type') || '';
  if (tipoContenido.includes('application/json')) {
    try { cuerpo = await respuesta.json(); } catch (err) { cuerpo = null; }
  }

  if (respuesta.status === 401 && ruta !== '/api/admin/login') {
    cerrarSesion(true);
    throw new Error('Tu sesión expiró. Iniciá sesión nuevamente.');
  }

  if (!respuesta.ok) {
    const mensaje = (cuerpo && cuerpo.mensaje) ? cuerpo.mensaje : `Error inesperado (código ${respuesta.status}).`;
    throw new Error(mensaje);
  }

  return cuerpo;
}

// ============================================================
// Autenticación
// ============================================================

async function iniciar() {
  poblarSelectsCategorias();
  const token = localStorage.getItem(CLAVE_TOKEN);
  if (!token) {
    mostrarLogin();
    return;
  }
  try {
    const datos = await apiFetch('/api/admin/verificar');
    if (datos && datos.valido) {
      if (datos.usuario) localStorage.setItem(CLAVE_USUARIO, datos.usuario);
      await mostrarPanel();
    } else {
      cerrarSesion(false);
    }
  } catch (err) {
    cerrarSesion(false);
  }
}

function mostrarLogin() {
  document.getElementById('pantalla-login').classList.remove('oculta');
  document.getElementById('panel-admin').classList.add('oculta');
}

async function mostrarPanel() {
  document.getElementById('pantalla-login').classList.add('oculta');
  document.getElementById('panel-admin').classList.remove('oculta');
  document.getElementById('usuario-actual').textContent = localStorage.getItem(CLAVE_USUARIO) || '';
  await cambiarSeccion('dashboard');
}

function cerrarSesion(porExpiracion) {
  localStorage.removeItem(CLAVE_TOKEN);
  localStorage.removeItem(CLAVE_USUARIO);
  mostrarLogin();
  document.getElementById('form-login').reset();
  if (porExpiracion) mostrarToast('Tu sesión expiró, iniciá sesión nuevamente.', 'error');
}

async function manejarEnvioLogin(evento) {
  evento.preventDefault();
  const usuario = document.getElementById('login-usuario').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.classList.add('oculta');
  const btn = document.getElementById('btn-login');
  btn.disabled = true;
  btn.textContent = 'Ingresando…';
  try {
    const datos = await apiFetch('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ usuario, password }),
    });
    localStorage.setItem(CLAVE_TOKEN, datos.token);
    localStorage.setItem(CLAVE_USUARIO, datos.usuario || usuario);
    await mostrarPanel();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('oculta');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ingresar';
  }
}

// ============================================================
// Navegación entre secciones / menú lateral
// ============================================================

async function cambiarSeccion(nombre) {
  document.querySelectorAll('.seccion').forEach((s) => s.classList.add('oculta'));
  document.getElementById(`seccion-${nombre}`).classList.remove('oculta');
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('activo', b.dataset.seccion === nombre));
  cerrarSidebarMovil();

  switch (nombre) {
    case 'dashboard':
      await cargarDashboard();
      break;
    case 'noticias':
      await Promise.all([cargarFuentesParaFiltro(), cargarNoticias()]);
      break;
    case 'fuentes':
      await cargarFuentes();
      break;
    case 'publicidades':
      await cargarPublicidades();
      break;
    case 'configuracion':
      await cargarConfig();
      break;
    default:
      break;
  }
}

function cerrarSidebarMovil() {
  document.getElementById('sidebar').classList.remove('abierta');
  document.getElementById('fondo-sidebar').classList.add('oculta');
}

// ============================================================
// Notificaciones tipo toast
// ============================================================

function mostrarToast(mensaje, tipo = 'exito') {
  const contenedor = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.textContent = mensaje;
  contenedor.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-salir');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============================================================
// Modal de confirmación genérico (reemplaza confirm() nativo)
// ============================================================

function pedirConfirmacion(mensaje, textoBoton = 'Eliminar') {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal-confirmar');
    document.getElementById('modal-confirmar-mensaje').textContent = mensaje;
    const btnAceptar = document.getElementById('modal-confirmar-aceptar');
    const btnCancelar = document.getElementById('modal-confirmar-cancelar');
    btnAceptar.textContent = textoBoton;
    modal.classList.remove('oculta');

    function limpiar(resultado) {
      modal.classList.add('oculta');
      btnAceptar.removeEventListener('click', onAceptar);
      btnCancelar.removeEventListener('click', onCancelar);
      resolve(resultado);
    }
    function onAceptar() { limpiar(true); }
    function onCancelar() { limpiar(false); }

    btnAceptar.addEventListener('click', onAceptar);
    btnCancelar.addEventListener('click', onCancelar);
  });
}

function abrirModal(id) { document.getElementById(id).classList.remove('oculta'); }
function cerrarModal(id) { document.getElementById(id).classList.add('oculta'); }

// ============================================================
// DASHBOARD
// ============================================================

async function cargarDashboard() {
  try {
    const stats = await apiFetch('/api/admin/stats');
    document.getElementById('stat-hoy').textContent = stats.hoy ?? 0;
    document.getElementById('stat-semana').textContent = stats.semana ?? 0;
    document.getElementById('stat-total').textContent = stats.total ?? 0;
    document.getElementById('stat-fuentes-activas').textContent = stats.fuentesActivas ?? 0;
    document.getElementById('stat-suscriptores').textContent = stats.suscriptoresActivos ?? 0;
    document.getElementById('dash-ultima-lectura').textContent = stats.ultimaLecturaRss ? formatearFecha(stats.ultimaLecturaRss) : 'Sin datos todavía';
    document.getElementById('dash-ultimo-resultado').textContent = stats.ultimoResultadoRss || 'Sin datos todavía';
    ultimoPorDia = Array.isArray(stats.porDia) ? stats.porDia : [];
    dibujarGrafico(ultimoPorDia);
  } catch (err) {
    mostrarToast(`No se pudieron cargar las estadísticas: ${err.message}`, 'error');
  }

  try {
    const logs = await apiFetch('/api/admin/logs?limite=10');
    renderizarLogs(comoArreglo(logs, 'logs').slice(0, 10));
  } catch (err) {
    mostrarToast(`No se pudieron cargar los registros del log: ${err.message}`, 'error');
  }
}

function renderizarLogs(logs) {
  const tbody = document.getElementById('tabla-logs-body');
  if (!logs.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="celda-vacia">No hay registros todavía.</td></tr>';
    return;
  }
  tbody.innerHTML = logs.map((log) => `
    <tr>
      <td><span class="badge badge-log-${escaparHtml(log.tipo || 'info')}">${escaparHtml(log.tipo || 'info')}</span></td>
      <td>${escaparHtml(log.mensaje)}</td>
      <td>${log.detalle ? escaparHtml(log.detalle) : '—'}</td>
      <td>${formatearFecha(log.fecha)}</td>
    </tr>`).join('');
}

function formatearEtiquetaDia(fechaIso) {
  if (!fechaIso) return '';
  const fecha = new Date(fechaIso);
  if (isNaN(fecha.getTime())) return String(fechaIso).slice(5, 10);
  return fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

// Gráfico de barras dibujado a mano con canvas 2D, sin librerías externas.
function dibujarGrafico(porDia) {
  const canvas = document.getElementById('grafico-noticias');
  const contenedor = canvas.parentElement;
  const anchoCss = Math.max(280, contenedor.clientWidth);
  const altoCss = 260;
  const ratio = window.devicePixelRatio || 1;

  canvas.style.width = `${anchoCss}px`;
  canvas.style.height = `${altoCss}px`;
  canvas.width = anchoCss * ratio;
  canvas.height = altoCss * ratio;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, anchoCss, altoCss);

  const datos = Array.isArray(porDia) ? porDia : [];
  const margenIzq = 42;
  const margenInf = 34;
  const margenSup = 18;
  const margenDer = 16;
  const anchoGrafico = anchoCss - margenIzq - margenDer;
  const altoGrafico = altoCss - margenSup - margenInf;
  const maximo = Math.max(1, ...datos.map((d) => Number(d.cantidad) || 0));

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margenIzq, margenSup);
  ctx.lineTo(margenIzq, margenSup + altoGrafico);
  ctx.lineTo(margenIzq + anchoGrafico, margenSup + altoGrafico);
  ctx.stroke();

  ctx.font = '11px -apple-system, sans-serif';
  ctx.textAlign = 'right';
  const divisiones = 4;
  for (let i = 0; i <= divisiones; i += 1) {
    const y = margenSup + altoGrafico - (altoGrafico / divisiones) * i;
    const valor = Math.round((maximo / divisiones) * i);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
    ctx.beginPath();
    ctx.moveTo(margenIzq, y);
    ctx.lineTo(margenIzq + anchoGrafico, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
    ctx.fillText(String(valor), margenIzq - 8, y + 3);
  }

  if (!datos.length) {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
    ctx.fillText('Sin datos para mostrar', anchoCss / 2, altoCss / 2);
    return;
  }

  const anchoBarra = anchoGrafico / datos.length;
  ctx.textAlign = 'center';
  datos.forEach((d, i) => {
    const cantidad = Number(d.cantidad) || 0;
    const alturaBarra = maximo > 0 ? (cantidad / maximo) * altoGrafico : 0;
    const x = margenIzq + i * anchoBarra + anchoBarra * 0.18;
    const anchoReal = anchoBarra * 0.64;
    const y = margenSup + altoGrafico - alturaBarra;

    const gradiente = ctx.createLinearGradient(0, y, 0, margenSup + altoGrafico);
    gradiente.addColorStop(0, '#4c6ef5');
    gradiente.addColorStop(1, '#243b8f');
    ctx.fillStyle = gradiente;
    ctx.fillRect(x, y, anchoReal, alturaBarra);

    ctx.fillStyle = '#e8edf7';
    const yEtiquetaValor = (y - 6) < margenSup ? y + 12 : y - 6;
    ctx.fillText(String(cantidad), x + anchoReal / 2, yEtiquetaValor);

    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.fillText(formatearEtiquetaDia(d.fecha), x + anchoReal / 2, margenSup + altoGrafico + 18);
  });
}

// ============================================================
// NOTICIAS
// ============================================================

function poblarSelectsCategorias() {
  const filtroCategoria = document.getElementById('filtro-categoria-noticias');
  const selectNoticia = document.getElementById('noticia-categoria');

  filtroCategoria.innerHTML = '<option value="">Todas las categorías</option>'
    + CATEGORIAS.map((c) => `<option value="${escaparHtml(c)}">${escaparHtml(c)}</option>`).join('');

  selectNoticia.innerHTML = CATEGORIAS.map((c) => `<option value="${escaparHtml(c)}">${escaparHtml(c)}</option>`).join('');
}

async function cargarFuentesParaFiltro() {
  try {
    const datos = await apiFetch('/api/admin/fuentes');
    const lista = comoArreglo(datos, 'fuentes');
    const sel = document.getElementById('filtro-fuente-noticias');
    const actual = sel.value;
    sel.innerHTML = '<option value="">Todas las fuentes</option>'
      + lista.map((f) => `<option value="${f.id}">${escaparHtml(f.nombre)}</option>`).join('');
    if (actual) sel.value = actual;
  } catch (err) {
    // No bloquea la carga de noticias si falla el listado de fuentes para el filtro.
  }
}

async function cargarNoticias() {
  const tbody = document.getElementById('tabla-noticias-body');
  tbody.innerHTML = '<tr><td colspan="8" class="celda-vacia">Cargando…</td></tr>';
  try {
    const params = new URLSearchParams();
    params.set('pagina', String(estadoNoticias.pagina));
    if (estadoNoticias.buscar) params.set('buscar', estadoNoticias.buscar);
    if (estadoNoticias.categoria) params.set('categoria', estadoNoticias.categoria);
    if (estadoNoticias.fuente) params.set('fuente', estadoNoticias.fuente);

    const datos = await apiFetch(`/api/admin/noticias?${params.toString()}`);
    const lista = comoArreglo(datos, 'noticias');
    cacheNoticias = new Map(lista.map((n) => [String(n.id), n]));
    renderizarNoticias(lista);
    renderizarPaginacion('paginacion-noticias', datos.pagina || estadoNoticias.pagina, datos.totalPaginas || 1, (nuevaPagina) => {
      estadoNoticias.pagina = nuevaPagina;
      cargarNoticias();
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="celda-vacia">Error al cargar noticias: ${escaparHtml(err.message)}</td></tr>`;
  }
}

function renderizarNoticias(lista) {
  const tbody = document.getElementById('tabla-noticias-body');
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="celda-vacia">No se encontraron noticias con estos filtros.</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map((n) => `
    <tr>
      <td class="celda-titulo">${escaparHtml(n.titulo)}</td>
      <td>${n.es_propia ? '<span class="badge badge-propia">Propia</span>' : '<span class="badge badge-rss">RSS</span>'}</td>
      <td>${escaparHtml(n.categoria || 'General')}</td>
      <td>${escaparHtml(n.fuente_nombre || '—')}</td>
      <td>${formatearFecha(n.fecha_publicacion)}</td>
      <td><button type="button" class="btn-toggle ${n.destacada ? 'activo-si' : ''}" data-accion="destacar" data-id="${n.id}">${n.destacada ? '★ Sí' : '☆ No'}</button></td>
      <td><button type="button" class="btn-toggle ${n.oculta ? 'activo-no' : ''}" data-accion="ocultar" data-id="${n.id}">${n.oculta ? '🙈 Oculta' : '👁 Visible'}</button></td>
      <td class="celda-acciones">
        <button type="button" class="btn-accion" data-accion="editar" data-id="${n.id}" title="Editar">✏️</button>
        <button type="button" class="btn-accion btn-accion-peligro" data-accion="eliminar" data-id="${n.id}" title="Eliminar">🗑️</button>
      </td>
    </tr>`).join('');
}

async function alternarDestacar(id) {
  try {
    await apiFetch(`/api/admin/noticias/${id}/destacar`, { method: 'PATCH' });
    mostrarToast('Estado de destacada actualizado.', 'exito');
    await cargarNoticias();
  } catch (err) {
    mostrarToast(`No se pudo actualizar: ${err.message}`, 'error');
  }
}

async function alternarOcultar(id) {
  try {
    await apiFetch(`/api/admin/noticias/${id}/ocultar`, { method: 'PATCH' });
    mostrarToast('Visibilidad actualizada.', 'exito');
    await cargarNoticias();
  } catch (err) {
    mostrarToast(`No se pudo actualizar: ${err.message}`, 'error');
  }
}

async function eliminarNoticia(id, noticia) {
  const titulo = noticia ? noticia.titulo : `#${id}`;
  const ok = await pedirConfirmacion(`¿Eliminar la noticia "${titulo}"? Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await apiFetch(`/api/admin/noticias/${id}`, { method: 'DELETE' });
    mostrarToast('Noticia eliminada correctamente.', 'exito');
    await cargarNoticias();
  } catch (err) {
    mostrarToast(`No se pudo eliminar la noticia: ${err.message}`, 'error');
  }
}

function actualizarContadorResumen() {
  const campo = document.getElementById('noticia-resumen');
  document.getElementById('contador-resumen').textContent = `${campo.value.length}/300`;
}

function abrirModalNoticia(noticia) {
  const form = document.getElementById('form-noticia');
  form.reset();
  document.getElementById('noticia-form-error').classList.add('oculta');
  document.getElementById('noticia-id').value = noticia ? noticia.id : '';
  document.getElementById('modal-noticia-titulo').textContent = noticia ? 'Editar noticia' : 'Nueva noticia';
  document.getElementById('noticia-titulo').value = noticia ? noticia.titulo : '';
  document.getElementById('noticia-resumen').value = noticia ? noticia.resumen : '';
  document.getElementById('noticia-categoria').value = noticia ? (noticia.categoria || 'General') : 'General';
  document.getElementById('noticia-imagen').value = noticia ? (noticia.imagen_url || '') : '';
  actualizarContadorResumen();

  const grupoContenido = document.getElementById('grupo-noticia-contenido');
  const campoContenido = document.getElementById('noticia-contenido');
  const grupoLink = document.getElementById('grupo-noticia-link');

  // Una noticia nueva siempre se crea como propia. Al editar, respetamos es_propia.
  const esPropia = noticia ? !!noticia.es_propia : true;

  if (esPropia) {
    grupoContenido.classList.remove('oculta');
    campoContenido.required = !noticia;
    campoContenido.value = noticia ? (noticia.contenido_propio || '') : '';
    grupoLink.classList.add('oculta');
  } else {
    grupoContenido.classList.add('oculta');
    campoContenido.required = false;
    campoContenido.value = '';
    grupoLink.classList.remove('oculta');
    document.getElementById('noticia-link-original').textContent = noticia.link_original || '—';
  }

  abrirModal('modal-noticia');
}

async function manejarEnvioNoticia(evento) {
  evento.preventDefault();
  const id = document.getElementById('noticia-id').value;
  const errorEl = document.getElementById('noticia-form-error');
  errorEl.classList.add('oculta');

  const cuerpo = {
    titulo: document.getElementById('noticia-titulo').value.trim(),
    resumen: document.getElementById('noticia-resumen').value.trim(),
    categoria: document.getElementById('noticia-categoria').value,
    imagen_url: document.getElementById('noticia-imagen').value.trim(),
  };

  const grupoContenidoVisible = !document.getElementById('grupo-noticia-contenido').classList.contains('oculta');
  if (grupoContenidoVisible) {
    cuerpo.contenido_propio = document.getElementById('noticia-contenido').value.trim();
  }
  if (!id) cuerpo.es_propia = true;

  const btn = document.getElementById('btn-guardar-noticia');
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    if (id) {
      await apiFetch(`/api/admin/noticias/${id}`, { method: 'PUT', body: JSON.stringify(cuerpo) });
      mostrarToast('Noticia actualizada correctamente.', 'exito');
    } else {
      await apiFetch('/api/admin/noticias', { method: 'POST', body: JSON.stringify(cuerpo) });
      mostrarToast('Noticia creada correctamente.', 'exito');
    }
    cerrarModal('modal-noticia');
    await cargarNoticias();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('oculta');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
}

// Paginación genérica reutilizada por las secciones que paginan.
function renderizarPaginacion(contenedorId, paginaActual, totalPaginas, alCambiar) {
  const cont = document.getElementById(contenedorId);
  totalPaginas = Math.max(1, totalPaginas || 1);
  paginaActual = Math.max(1, paginaActual || 1);
  cont.innerHTML = '';

  const btnAnterior = document.createElement('button');
  btnAnterior.type = 'button';
  btnAnterior.className = 'btn btn-secundario btn-paginacion';
  btnAnterior.textContent = '‹ Anterior';
  btnAnterior.disabled = paginaActual <= 1;
  btnAnterior.addEventListener('click', () => alCambiar(paginaActual - 1));

  const info = document.createElement('span');
  info.className = 'paginacion-info';
  info.textContent = `Página ${paginaActual} de ${totalPaginas}`;

  const btnSiguiente = document.createElement('button');
  btnSiguiente.type = 'button';
  btnSiguiente.className = 'btn btn-secundario btn-paginacion';
  btnSiguiente.textContent = 'Siguiente ›';
  btnSiguiente.disabled = paginaActual >= totalPaginas;
  btnSiguiente.addEventListener('click', () => alCambiar(paginaActual + 1));

  cont.append(btnAnterior, info, btnSiguiente);
}

// ============================================================
// FUENTES RSS
// ============================================================

async function cargarFuentes() {
  const tbody = document.getElementById('tabla-fuentes-body');
  tbody.innerHTML = '<tr><td colspan="8" class="celda-vacia">Cargando…</td></tr>';
  try {
    const datos = await apiFetch('/api/admin/fuentes');
    const lista = comoArreglo(datos, 'fuentes');
    cacheFuentes = new Map(lista.map((f) => [String(f.id), f]));
    renderizarFuentes(lista);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="celda-vacia">Error al cargar fuentes: ${escaparHtml(err.message)}</td></tr>`;
  }
}

function renderizarFuentes(lista) {
  const tbody = document.getElementById('tabla-fuentes-body');
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="celda-vacia">Todavía no hay fuentes cargadas.</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map((f) => `
    <tr>
      <td>${escaparHtml(f.nombre)}</td>
      <td class="celda-url"><a href="${escaparHtml(f.url_rss)}" target="_blank" rel="noopener noreferrer">${escaparHtml(f.url_rss)}</a></td>
      <td class="celda-acciones">
        <button type="button" class="btn-accion" data-accion="actualizar" data-id="${f.id}" title="Actualizar ahora">🔄</button>
        <button type="button" class="btn-accion" data-accion="editar" data-id="${f.id}" title="Editar">✏️</button>
        <button type="button" class="btn-accion btn-accion-peligro" data-accion="eliminar" data-id="${f.id}" title="Eliminar">🗑️</button>
      </td>
      <td><button type="button" class="btn-toggle ${f.activa ? 'activo-si' : ''}" data-accion="activar" data-id="${f.id}">${f.activa ? '✅ Activa' : '⛔ Inactiva'}</button></td>
      <td>${f.ultima_lectura ? formatearFecha(f.ultima_lectura) : 'Nunca'}</td>
      <td>${f.total_noticias ?? 0}</td>
      <td class="celda-error">${f.ultimo_error ? `<span class="texto-error">${escaparHtml(f.ultimo_error)}</span>` : '—'}</td>
      <td>${f.categoria_default ? escaparHtml(f.categoria_default) : '<span class="texto-secundario">Automático</span>'}</td>
    </tr>`).join('');
}

async function alternarActivaFuente(fuente) {
  try {
    await apiFetch(`/api/admin/fuentes/${fuente.id}`, { method: 'PUT', body: JSON.stringify({ activa: !fuente.activa }) });
    mostrarToast(`Fuente ${!fuente.activa ? 'activada' : 'desactivada'} correctamente.`, 'exito');
    await cargarFuentes();
  } catch (err) {
    mostrarToast(`No se pudo cambiar el estado de la fuente: ${err.message}`, 'error');
  }
}

async function actualizarFuenteIndividual(fuente, btn) {
  btn.disabled = true;
  try {
    const resultado = await apiFetch('/api/admin/rss/actualizar', { method: 'POST', body: JSON.stringify({ fuente_id: fuente.id }) });
    const tieneErrores = !!resultado.error || (Array.isArray(resultado.errores) && resultado.errores.length > 0);
    const mensaje = resultado.error
      ? `"${fuente.nombre}": ${resultado.error}`
      : `"${fuente.nombre}": ${resultado.noticiasNuevas ?? 0} noticias nuevas.`;
    mostrarToast(mensaje, tieneErrores ? 'error' : 'exito');
    await cargarFuentes();
  } catch (err) {
    mostrarToast(`No se pudo actualizar la fuente: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function actualizarTodasLasFuentes() {
  const btn = document.getElementById('btn-actualizar-todas');
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = 'Actualizando…';
  try {
    const resultado = await apiFetch('/api/admin/rss/actualizar', { method: 'POST', body: JSON.stringify({}) });
    const errores = Array.isArray(resultado.errores) ? resultado.errores : [];
    const detalle = errores.length ? ` (${errores.length} con error: ${errores.map((e) => e.fuente || e.error || String(e)).join(', ')})` : '';
    mostrarToast(`Se leyeron ${resultado.fuentesLeidas ?? 0} fuentes y se sumaron ${resultado.noticiasNuevas ?? 0} noticias nuevas${detalle}.`, errores.length ? 'error' : 'exito');
    await cargarFuentes();
  } catch (err) {
    mostrarToast(`No se pudo actualizar las fuentes: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

async function eliminarFuente(fuente) {
  const ok = await pedirConfirmacion(`¿Eliminar la fuente "${fuente.nombre}"? Las noticias que ya trajo no se eliminan.`);
  if (!ok) return;
  try {
    await apiFetch(`/api/admin/fuentes/${fuente.id}`, { method: 'DELETE' });
    mostrarToast('Fuente eliminada correctamente.', 'exito');
    await cargarFuentes();
  } catch (err) {
    mostrarToast(`No se pudo eliminar la fuente: ${err.message}`, 'error');
  }
}

function abrirModalFuente(fuente) {
  const form = document.getElementById('form-fuente');
  form.reset();
  document.getElementById('fuente-form-error').classList.add('oculta');
  document.getElementById('fuente-id').value = fuente ? fuente.id : '';
  document.getElementById('modal-fuente-titulo').textContent = fuente ? 'Editar fuente RSS' : 'Agregar fuente RSS';
  document.getElementById('fuente-nombre').value = fuente ? fuente.nombre : '';
  document.getElementById('fuente-url').value = fuente ? fuente.url_rss : '';
  document.getElementById('fuente-sitio').value = fuente ? (fuente.sitio_web || '') : '';
  document.getElementById('fuente-categoria').value = fuente ? (fuente.categoria_default || '') : '';
  document.getElementById('resultado-validacion').innerHTML = '';
  document.getElementById('grupo-guardar-sin-validar').classList.add('oculta');
  document.getElementById('chk-guardar-sin-validar').checked = false;

  // Cada vez que se abre el modal (alta o edición) hay que validar el feed
  // de nuevo antes de poder guardar, tal como pide la consigna.
  feedValidado = false;
  document.getElementById('btn-guardar-fuente').disabled = true;

  abrirModal('modal-fuente');
}

function manejarCambioUrlFuente() {
  feedValidado = false;
  document.getElementById('resultado-validacion').innerHTML = '';
  document.getElementById('grupo-guardar-sin-validar').classList.add('oculta');
  document.getElementById('chk-guardar-sin-validar').checked = false;
  document.getElementById('btn-guardar-fuente').disabled = true;
}

async function manejarValidarFuente() {
  const url = document.getElementById('fuente-url').value.trim();
  const resultadoDiv = document.getElementById('resultado-validacion');
  const errorEl = document.getElementById('fuente-form-error');
  errorEl.classList.add('oculta');

  if (!url) {
    errorEl.textContent = 'Ingresá una URL de feed antes de validar.';
    errorEl.classList.remove('oculta');
    return;
  }

  const btn = document.getElementById('btn-validar-fuente');
  btn.disabled = true;
  btn.textContent = 'Validando…';
  resultadoDiv.innerHTML = '<span class="texto-secundario">Validando el feed…</span>';

  try {
    const datos = await apiFetch('/api/admin/fuentes/validar', { method: 'POST', body: JSON.stringify({ url_rss: url }) });
    if (datos.valido) {
      feedValidado = true;
      document.getElementById('btn-guardar-fuente').disabled = false;
      document.getElementById('grupo-guardar-sin-validar').classList.add('oculta');
      const titulos = Array.isArray(datos.titulos) ? datos.titulos : [];
      resultadoDiv.innerHTML = `<span class="texto-exito">✔ Feed válido.</span>`
        + `<ul class="lista-preview">${titulos.length ? titulos.map((t) => `<li>${escaparHtml(t)}</li>`).join('') : '<li>El feed no devolvió títulos de muestra.</li>'}</ul>`;
    } else {
      feedValidado = false;
      document.getElementById('btn-guardar-fuente').disabled = true;
      document.getElementById('grupo-guardar-sin-validar').classList.remove('oculta');
      resultadoDiv.innerHTML = `<span class="texto-error">✘ ${escaparHtml(datos.mensaje || 'El feed no es válido.')}</span>`;
    }
  } catch (err) {
    feedValidado = false;
    document.getElementById('btn-guardar-fuente').disabled = true;
    document.getElementById('grupo-guardar-sin-validar').classList.remove('oculta');
    resultadoDiv.innerHTML = `<span class="texto-error">✘ ${escaparHtml(err.message)}</span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Validar feed';
  }
}

async function manejarEnvioFuente(evento) {
  evento.preventDefault();
  const id = document.getElementById('fuente-id').value;
  const errorEl = document.getElementById('fuente-form-error');
  errorEl.classList.add('oculta');

  const cuerpo = {
    nombre: document.getElementById('fuente-nombre').value.trim(),
    url_rss: document.getElementById('fuente-url').value.trim(),
    sitio_web: document.getElementById('fuente-sitio').value.trim(),
    categoria_default: document.getElementById('fuente-categoria').value,
  };

  const btn = document.getElementById('btn-guardar-fuente');
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = 'Guardando…';
  try {
    if (id) {
      await apiFetch(`/api/admin/fuentes/${id}`, { method: 'PUT', body: JSON.stringify(cuerpo) });
    } else {
      await apiFetch('/api/admin/fuentes', { method: 'POST', body: JSON.stringify(cuerpo) });
    }
    mostrarToast(id ? 'Fuente actualizada correctamente.' : 'Fuente agregada correctamente.', 'exito');
    cerrarModal('modal-fuente');
    await cargarFuentes();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('oculta');
    btn.disabled = false;
  } finally {
    btn.textContent = textoOriginal;
  }
}

// ============================================================
// PUBLICIDADES
// ============================================================

async function cargarPublicidades() {
  const tbody = document.getElementById('tabla-publicidades-body');
  tbody.innerHTML = '<tr><td colspan="8" class="celda-vacia">Cargando…</td></tr>';
  try {
    const datos = await apiFetch('/api/admin/publicidades');
    const lista = comoArreglo(datos, 'publicidades');
    cachePublicidades = new Map(lista.map((p) => [String(p.id), p]));
    renderizarPublicidades(lista);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="celda-vacia">Error al cargar publicidades: ${escaparHtml(err.message)}</td></tr>`;
  }
}

function renderizarPublicidades(lista) {
  const tbody = document.getElementById('tabla-publicidades-body');
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="celda-vacia">Todavía no hay publicidades cargadas.</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map((p) => `
    <tr>
      <td>${escaparHtml(p.nombre)}</td>
      <td>${escaparHtml(ETIQUETAS_POSICION[p.posicion] || p.posicion)}</td>
      <td>${formatearVigencia(p.fecha_inicio, p.fecha_fin)}</td>
      <td><button type="button" class="btn-toggle ${p.activa ? 'activo-si' : ''}" data-accion="activar" data-id="${p.id}">${p.activa ? '✅ Activa' : '⛔ Inactiva'}</button></td>
      <td>${p.impresiones ?? 0}</td>
      <td>${p.clicks ?? 0}</td>
      <td>${calcularCtr(p.impresiones, p.clicks)}</td>
      <td class="celda-acciones">
        <button type="button" class="btn-accion" data-accion="editar" data-id="${p.id}" title="Editar">✏️</button>
        <button type="button" class="btn-accion btn-accion-peligro" data-accion="eliminar" data-id="${p.id}" title="Eliminar">🗑️</button>
      </td>
    </tr>`).join('');
}

async function alternarActivaPublicidad(pub) {
  try {
    await apiFetch(`/api/admin/publicidades/${pub.id}`, { method: 'PUT', body: JSON.stringify({ activa: !pub.activa }) });
    mostrarToast(`Publicidad ${!pub.activa ? 'activada' : 'desactivada'} correctamente.`, 'exito');
    await cargarPublicidades();
  } catch (err) {
    mostrarToast(`No se pudo cambiar el estado de la publicidad: ${err.message}`, 'error');
  }
}

async function eliminarPublicidad(pub) {
  const ok = await pedirConfirmacion(`¿Eliminar la publicidad "${pub.nombre}"?`);
  if (!ok) return;
  try {
    await apiFetch(`/api/admin/publicidades/${pub.id}`, { method: 'DELETE' });
    mostrarToast('Publicidad eliminada correctamente.', 'exito');
    await cargarPublicidades();
  } catch (err) {
    mostrarToast(`No se pudo eliminar la publicidad: ${err.message}`, 'error');
  }
}

function actualizarVistaPreviaPublicidad() {
  const url = document.getElementById('publicidad-imagen').value.trim();
  const link = document.getElementById('publicidad-link').value.trim() || '#';
  const img = document.getElementById('preview-publicidad-img');
  const a = document.getElementById('preview-publicidad-link');
  const vacio = document.getElementById('preview-publicidad-vacio');

  a.href = link;
  if (url) {
    img.src = url;
    vacio.classList.add('oculta');
  } else {
    img.removeAttribute('src');
    img.style.display = 'none';
    vacio.classList.remove('oculta');
  }
}

function abrirModalPublicidad(pub) {
  const form = document.getElementById('form-publicidad');
  form.reset();
  document.getElementById('publicidad-form-error').classList.add('oculta');
  document.getElementById('publicidad-id').value = pub ? pub.id : '';
  document.getElementById('modal-publicidad-titulo').textContent = pub ? 'Editar publicidad' : 'Nueva publicidad';
  document.getElementById('publicidad-nombre').value = pub ? pub.nombre : '';
  document.getElementById('publicidad-imagen').value = pub ? pub.imagen_url : '';
  document.getElementById('publicidad-link').value = pub ? pub.link_destino : '';
  document.getElementById('publicidad-posicion').value = pub ? pub.posicion : 'header';
  document.getElementById('publicidad-inicio').value = pub && pub.fecha_inicio ? String(pub.fecha_inicio).slice(0, 10) : '';
  document.getElementById('publicidad-fin').value = pub && pub.fecha_fin ? String(pub.fecha_fin).slice(0, 10) : '';
  actualizarVistaPreviaPublicidad();
  abrirModal('modal-publicidad');
}

async function manejarEnvioPublicidad(evento) {
  evento.preventDefault();
  const id = document.getElementById('publicidad-id').value;
  const errorEl = document.getElementById('publicidad-form-error');
  errorEl.classList.add('oculta');

  const inicio = document.getElementById('publicidad-inicio').value;
  const fin = document.getElementById('publicidad-fin').value;
  if (inicio && fin && inicio > fin) {
    errorEl.textContent = 'La fecha de inicio no puede ser posterior a la fecha de fin.';
    errorEl.classList.remove('oculta');
    return;
  }

  const cuerpo = {
    nombre: document.getElementById('publicidad-nombre').value.trim(),
    imagen_url: document.getElementById('publicidad-imagen').value.trim(),
    link_destino: document.getElementById('publicidad-link').value.trim(),
    posicion: document.getElementById('publicidad-posicion').value,
    fecha_inicio: inicio || null,
    fecha_fin: fin || null,
  };

  const btn = evento.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = 'Guardando…';
  try {
    if (id) {
      await apiFetch(`/api/admin/publicidades/${id}`, { method: 'PUT', body: JSON.stringify(cuerpo) });
    } else {
      await apiFetch('/api/admin/publicidades', { method: 'POST', body: JSON.stringify(cuerpo) });
    }
    mostrarToast(id ? 'Publicidad actualizada correctamente.' : 'Publicidad creada correctamente.', 'exito');
    cerrarModal('modal-publicidad');
    await cargarPublicidades();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('oculta');
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ============================================================
// CONFIGURACIÓN
// ============================================================

async function cargarConfig() {
  try {
    const datos = await apiFetch('/api/admin/config');
    configCache = datos || {};
    document.getElementById('cfg-nombre-portal').value = configCache.nombre_portal || '';
    document.getElementById('cfg-logo-url').value = configCache.logo_url || '';
    document.getElementById('cfg-color-primario').value = configCache.color_primario || '#1a237e';
    document.getElementById('cfg-color-acento').value = configCache.color_acento || '#c62828';
    document.getElementById('cfg-intervalo-rss').value = configCache.intervalo_rss_minutos || 30;
    document.getElementById('cfg-noticias-pagina').value = configCache.noticias_por_pagina || 20;
    document.getElementById('cfg-texto-legal').value = configCache.texto_legal_footer || '';
  } catch (err) {
    mostrarToast(`No se pudo cargar la configuración: ${err.message}`, 'error');
  }
}

async function manejarEnvioConfig(evento) {
  evento.preventDefault();
  const intervalo = parseInt(document.getElementById('cfg-intervalo-rss').value, 10);
  const porPagina = parseInt(document.getElementById('cfg-noticias-pagina').value, 10);

  if (!intervalo || intervalo < 1) {
    mostrarToast('El intervalo de actualización RSS debe ser un número mayor a 0.', 'error');
    return;
  }
  if (!porPagina || porPagina < 1) {
    mostrarToast('Las noticias por página deben ser un número mayor a 0.', 'error');
    return;
  }

  const cuerpo = {
    nombre_portal: document.getElementById('cfg-nombre-portal').value.trim(),
    logo_url: document.getElementById('cfg-logo-url').value.trim(),
    color_primario: document.getElementById('cfg-color-primario').value,
    color_acento: document.getElementById('cfg-color-acento').value,
    intervalo_rss_minutos: intervalo,
    noticias_por_pagina: porPagina,
    texto_legal_footer: document.getElementById('cfg-texto-legal').value.trim(),
  };

  const btn = evento.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = 'Guardando…';
  try {
    await apiFetch('/api/admin/config', { method: 'PUT', body: JSON.stringify(cuerpo) });
    mostrarToast('Configuración guardada correctamente.', 'exito');
  } catch (err) {
    mostrarToast(`No se pudo guardar la configuración: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

async function manejarEnvioPassword(evento) {
  evento.preventDefault();
  const actual = document.getElementById('pass-actual').value;
  const nueva = document.getElementById('pass-nueva').value;
  const confirmar = document.getElementById('pass-nueva-confirmar').value;

  if (nueva !== confirmar) {
    mostrarToast('La confirmación no coincide con la contraseña nueva.', 'error');
    return;
  }
  if (nueva.length < 6) {
    mostrarToast('La contraseña nueva debe tener al menos 6 caracteres.', 'error');
    return;
  }

  const btn = evento.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = 'Cambiando…';
  try {
    await apiFetch('/api/admin/password', {
      method: 'PUT',
      body: JSON.stringify({ passwordActual: actual, passwordNueva: nueva }),
    });
    mostrarToast('Contraseña actualizada correctamente.', 'exito');
    evento.target.reset();
  } catch (err) {
    mostrarToast(`No se pudo cambiar la contraseña: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ============================================================
// Registro de eventos (delegación incluida) e inicialización
// ============================================================

function registrarEventos() {
  // --- Login / sesión ---
  document.getElementById('form-login').addEventListener('submit', manejarEnvioLogin);
  document.getElementById('btn-logout').addEventListener('click', () => {
    cerrarSesion(false);
    mostrarToast('Sesión cerrada correctamente.', 'exito');
  });

  // --- Navegación ---
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => cambiarSeccion(btn.dataset.seccion));
  });

  // --- Menú móvil ---
  document.getElementById('btn-menu-movil').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('abierta');
    document.getElementById('fondo-sidebar').classList.toggle('oculta');
  });
  document.getElementById('fondo-sidebar').addEventListener('click', cerrarSidebarMovil);

  // --- Cierre genérico de modales ---
  document.querySelectorAll('[data-cerrar]').forEach((btn) => {
    btn.addEventListener('click', () => cerrarModal(btn.dataset.cerrar));
  });
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('oculta');
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay:not(.oculta)').forEach((m) => m.classList.add('oculta'));
    }
  });

  // --- Dashboard: redibujar el gráfico si cambia el tamaño de ventana ---
  window.addEventListener('resize', debounce(() => {
    if (!document.getElementById('seccion-dashboard').classList.contains('oculta')) {
      dibujarGrafico(ultimoPorDia);
    }
  }, 200));

  // --- Noticias: filtros ---
  document.getElementById('filtro-buscar-noticias').addEventListener('input', debounce(() => {
    estadoNoticias.buscar = document.getElementById('filtro-buscar-noticias').value.trim();
    estadoNoticias.pagina = 1;
    cargarNoticias();
  }, 350));
  document.getElementById('filtro-categoria-noticias').addEventListener('change', () => {
    estadoNoticias.categoria = document.getElementById('filtro-categoria-noticias').value;
    estadoNoticias.pagina = 1;
    cargarNoticias();
  });
  document.getElementById('filtro-fuente-noticias').addEventListener('change', () => {
    estadoNoticias.fuente = document.getElementById('filtro-fuente-noticias').value;
    estadoNoticias.pagina = 1;
    cargarNoticias();
  });

  // --- Noticias: acciones por fila (delegación de eventos) ---
  document.getElementById('tabla-noticias-body').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-accion]');
    if (!btn) return;
    const id = btn.dataset.id;
    const noticia = cacheNoticias.get(id);
    const accion = btn.dataset.accion;
    if (accion === 'destacar') alternarDestacar(id);
    else if (accion === 'ocultar') alternarOcultar(id);
    else if (accion === 'editar') abrirModalNoticia(noticia);
    else if (accion === 'eliminar') eliminarNoticia(id, noticia);
  });

  document.getElementById('btn-nueva-noticia').addEventListener('click', () => abrirModalNoticia(null));
  document.getElementById('noticia-resumen').addEventListener('input', actualizarContadorResumen);
  document.getElementById('form-noticia').addEventListener('submit', manejarEnvioNoticia);

  // --- Fuentes RSS ---
  document.getElementById('tabla-fuentes-body').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-accion]');
    if (!btn) return;
    const id = btn.dataset.id;
    const fuente = cacheFuentes.get(id);
    const accion = btn.dataset.accion;
    if (!fuente) return;
    if (accion === 'activar') alternarActivaFuente(fuente);
    else if (accion === 'actualizar') actualizarFuenteIndividual(fuente, btn);
    else if (accion === 'editar') abrirModalFuente(fuente);
    else if (accion === 'eliminar') eliminarFuente(fuente);
  });

  document.getElementById('btn-nueva-fuente').addEventListener('click', () => abrirModalFuente(null));
  document.getElementById('btn-actualizar-todas').addEventListener('click', actualizarTodasLasFuentes);
  document.getElementById('fuente-url').addEventListener('input', manejarCambioUrlFuente);
  document.getElementById('btn-validar-fuente').addEventListener('click', manejarValidarFuente);
  document.getElementById('chk-guardar-sin-validar').addEventListener('change', (e) => {
    document.getElementById('btn-guardar-fuente').disabled = !e.target.checked;
  });
  document.getElementById('form-fuente').addEventListener('submit', manejarEnvioFuente);

  // --- Publicidades ---
  document.getElementById('tabla-publicidades-body').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-accion]');
    if (!btn) return;
    const id = btn.dataset.id;
    const pub = cachePublicidades.get(id);
    const accion = btn.dataset.accion;
    if (!pub) return;
    if (accion === 'activar') alternarActivaPublicidad(pub);
    else if (accion === 'editar') abrirModalPublicidad(pub);
    else if (accion === 'eliminar') eliminarPublicidad(pub);
  });

  document.getElementById('btn-nueva-publicidad').addEventListener('click', () => abrirModalPublicidad(null));
  document.getElementById('publicidad-imagen').addEventListener('input', actualizarVistaPreviaPublicidad);
  document.getElementById('publicidad-link').addEventListener('input', actualizarVistaPreviaPublicidad);
  document.getElementById('preview-publicidad-img').addEventListener('error', function () { this.style.display = 'none'; });
  document.getElementById('preview-publicidad-img').addEventListener('load', function () { this.style.display = 'block'; });
  document.getElementById('form-publicidad').addEventListener('submit', manejarEnvioPublicidad);

  // --- Configuración ---
  document.getElementById('form-config').addEventListener('submit', manejarEnvioConfig);
  document.getElementById('form-password').addEventListener('submit', manejarEnvioPassword);
}

document.addEventListener('DOMContentLoaded', () => {
  registrarEventos();
  iniciar();
});
