/**
 * El Observador — Portal público
 * JS vanilla, sin frameworks. Todo el contenido que viene de la API
 * (títulos, resúmenes, nombres de fuente, etc.) se inserta siempre con
 * textContent o asignando propiedades del DOM, nunca con innerHTML, porque
 * proviene de feeds RSS de terceros y no es contenido de confianza.
 */

(function () {
  'use strict';

  var IMAGEN_PLACEHOLDER = 'img/placeholder.svg';
  var CATEGORIAS_POR_DEFECTO = [
    'Policial',
    'Político',
    'Deportivo'
  ];

  // Estado de la vista de listado/búsqueda de noticias.
  var estado = {
    modo: 'listado', // 'listado' | 'busqueda'
    categoria: '',
    periodo: '', // '' | '1h' | '24h' | '7d' | '30d' (ver #filtro-antiguedad)
    query: '',
    pagina: 1
  };

  var temporizadorBusqueda = null;

  // Localidad elegida para el pronóstico del ticker (ver #selector-localidad).
  // Se guarda en localStorage para que quede recordada entre visitas; si el
  // navegador no lo permite (modo privado, storage bloqueado) se sigue
  // funcionando igual, solo que sin recordar la elección.
  var LOCALIDAD_POR_DEFECTO = 'la-plata';
  var localidadClima = LOCALIDAD_POR_DEFECTO;
  try {
    localidadClima = window.localStorage.getItem('localidad-clima') || LOCALIDAD_POR_DEFECTO;
  } catch (error) {
    localidadClima = LOCALIDAD_POR_DEFECTO;
  }

  // ------------------------------------------------------------------
  // Referencias al DOM (el script se carga con "defer", el DOM ya existe)
  // ------------------------------------------------------------------

  var elReloj = document.getElementById('reloj');
  var elListaCategorias = document.getElementById('lista-categorias');
  var elFiltroAntiguedad = document.getElementById('filtro-antiguedad');
  var elSeccionDestacada = document.getElementById('seccion-destacada');
  var elGrilla = document.getElementById('grilla-noticias');
  var elMensajeEstado = document.getElementById('mensaje-estado');
  var elPaginacion = document.getElementById('paginacion');
  var elListaUltimas = document.getElementById('lista-ultimas');
  var elPublicidadesSidebar = document.getElementById('publicidades-sidebar');
  var elFormBusqueda = document.getElementById('form-busqueda');
  var elInputBusqueda = document.getElementById('input-busqueda');
  var elLogoInicio = document.getElementById('logo-inicio');
  var elLogoTexto = document.getElementById('logo-texto');
  var elLogoIconoSvg = document.getElementById('logo-icono-svg');
  var elLogoIconoPersonalizado = document.getElementById('logo-icono-personalizado');
  var elFooterNombre = document.getElementById('footer-nombre');
  var elTextoLegal = document.getElementById('texto-legal');
  var elSelectorLocalidad = document.getElementById('selector-localidad');
  var elTickerClima = document.getElementById('ticker-clima');
  var elTickerDolar = document.getElementById('ticker-dolar');
  var elFormSuscripcion = document.getElementById('form-suscripcion');
  var elInputSuscripcionEmail = document.getElementById('input-suscripcion-email');
  var elSuscripcionMensaje = document.getElementById('suscripcion-mensaje');

  // ------------------------------------------------------------------
  // Utilidades generales
  // ------------------------------------------------------------------

  /**
   * Hace fetch a la API pública y devuelve el JSON ya parseado.
   * Lanza un Error con mensaje en español ante cualquier falla
   * (de red, de parseo o de negocio con el shape {error, mensaje, codigo}).
   */
  function obtenerJSON(url, opciones) {
    return fetch(url, opciones)
      .catch(function () {
        throw new Error('No pudimos conectar con el servidor.');
      })
      .then(function (respuesta) {
        return respuesta
          .json()
          .catch(function () {
            return null;
          })
          .then(function (cuerpo) {
            if (!respuesta.ok || (cuerpo && cuerpo.error === true)) {
              var mensaje = (cuerpo && cuerpo.mensaje) || 'Error ' + respuesta.status;
              throw new Error(mensaje);
            }
            return cuerpo;
          });
      });
  }

  function enviarPost(url) {
    // Fire-and-forget: no bloquea ninguna navegación ni interacción del usuario.
    fetch(url, { method: 'POST' }).catch(function (error) {
      console.error('No se pudo completar la petición POST a ' + url, error);
    });
  }

  function vaciar(elemento) {
    while (elemento.firstChild) {
      elemento.removeChild(elemento.firstChild);
    }
  }

  /** Convierte una fecha ISO en texto relativo, en español ("hace 2 horas"). */
  function formatearFechaRelativa(fechaIso) {
    var fecha = new Date(fechaIso);
    if (isNaN(fecha.getTime())) {
      return '';
    }
    var diffMs = Date.now() - fecha.getTime();
    var diffSegundos = Math.round(diffMs / 1000);
    if (diffSegundos < 0) {
      diffSegundos = 0;
    }
    if (diffSegundos < 60) {
      return 'justo ahora';
    }
    var diffMinutos = Math.round(diffSegundos / 60);
    if (diffMinutos < 60) {
      return 'hace ' + diffMinutos + (diffMinutos === 1 ? ' minuto' : ' minutos');
    }
    var diffHoras = Math.round(diffMinutos / 60);
    if (diffHoras < 24) {
      return 'hace ' + diffHoras + (diffHoras === 1 ? ' hora' : ' horas');
    }
    var diffDias = Math.round(diffHoras / 24);
    if (diffDias < 30) {
      return 'hace ' + diffDias + (diffDias === 1 ? ' día' : ' días');
    }
    var diffMeses = Math.round(diffDias / 30);
    if (diffMeses < 12) {
      return 'hace ' + diffMeses + (diffMeses === 1 ? ' mes' : ' meses');
    }
    var diffAnios = Math.round(diffMeses / 12);
    return 'hace ' + diffAnios + (diffAnios === 1 ? ' año' : ' años');
  }

  /** Fecha completa en formato argentino, para usar como title/tooltip. */
  function formatearFechaCompleta(fechaIso) {
    var fecha = new Date(fechaIso);
    if (isNaN(fecha.getTime())) {
      return '';
    }
    try {
      return fecha.toLocaleString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return fecha.toISOString();
    }
  }

  /**
   * El servidor ya excluye del listado las noticias sin imagen (ver
   * routes/publico.js), pero eso no cubre una imagen_url que apunte a un
   * link roto (404, bloqueado por hotlink, etc.): esa sí llega con una
   * URL "válida" y recién se descubre que no carga en el navegador. Para
   * esos casos, en vez de mostrar el cartel "Sin imagen disponible", se
   * saca directamente la tarjeta entera (`contenedorSiFalla`) del
   * listado, para que nunca quede una noticia visible sin imagen real
   * sea cual sea la causa.
   * @param {HTMLImageElement} imgEl
   * @param {string} urlOriginal
   * @param {string} textoAlt
   * @param {HTMLElement} [contenedorSiFalla] - elemento a eliminar del DOM
   *   si la imagen no carga. Si no se pasa, cae al placeholder de
   *   siempre (uso interno, ej. la fuente ya validó que hay imagen).
   */
  function establecerImagenConFallback(imgEl, urlOriginal, textoAlt, contenedorSiFalla) {
    if (!urlOriginal) {
      if (contenedorSiFalla) {
        contenedorSiFalla.remove();
        return;
      }
      imgEl.src = IMAGEN_PLACEHOLDER;
      imgEl.alt = textoAlt;
      return;
    }
    imgEl.src = urlOriginal;
    imgEl.alt = textoAlt;
    imgEl.loading = 'lazy';
    imgEl.onerror = function () {
      imgEl.onerror = null;
      if (contenedorSiFalla) {
        contenedorSiFalla.remove();
      } else {
        imgEl.src = IMAGEN_PLACEHOLDER;
      }
    };
  }

  // ------------------------------------------------------------------
  // Apariencia (título, logo, colores, tamaño de letra) configurada
  // desde el panel admin (Configuración → Apariencia). El HTML ya trae
  // los valores por defecto escritos a mano como respaldo: si esto
  // falla (sin red, servidor caído), el sitio se ve igual que siempre.
  // ------------------------------------------------------------------

  function aplicarTema(tema) {
    if (!tema) {
      return;
    }
    var raiz = document.documentElement;

    if (tema.color_primario) {
      raiz.style.setProperty('--color-primario', tema.color_primario);
    }
    if (tema.color_acento) {
      raiz.style.setProperty('--color-acento', tema.color_acento);
    }
    if (tema.color_fondo) {
      raiz.style.setProperty('--color-fondo', tema.color_fondo);
    }
    if (tema.tamano_fuente_base) {
      raiz.style.fontSize = tema.tamano_fuente_base + 'px';
    }

    if (tema.nombre_portal) {
      document.title = document.title.replace('El Observador', tema.nombre_portal);
      if (elLogoTexto) elLogoTexto.textContent = tema.nombre_portal;
      if (elFooterNombre) elFooterNombre.textContent = tema.nombre_portal;
      if (elLogoInicio) elLogoInicio.setAttribute('aria-label', 'Ir al inicio de ' + tema.nombre_portal);
      setMetaContenido('og:title', tema.nombre_portal);
    }
    if (tema.logo_url && elLogoIconoPersonalizado && elLogoIconoSvg) {
      elLogoIconoPersonalizado.src = tema.logo_url;
      // display inline en vez de .hidden: hay una regla CSS "img {
      // display: block }" que le gana al [hidden] del navegador (ver
      // comentario en public/css/style.css, #logo-icono-personalizado).
      elLogoIconoPersonalizado.style.display = 'block';
      elLogoIconoSvg.style.display = 'none';
    }
    if (tema.texto_legal_footer && elTextoLegal) {
      elTextoLegal.textContent = tema.texto_legal_footer;
    }

    configurarAutorefresco(tema.intervalo_rss_minutos);
  }

  function cargarTema() {
    obtenerJSON('/api/tema')
      .then(aplicarTema)
      .catch(function (error) {
        console.error('No se pudo cargar la apariencia personalizada, se usan los valores por defecto.', error);
        // Si ni siquiera esto respondió, se usa igual el intervalo por
        // defecto: el portal debe autorefrescarse pase lo que pase, no
        // solo cuando /api/tema esté disponible.
        configurarAutorefresco(null);
      });
  }

  // ------------------------------------------------------------------
  // Autorefresco: el portal vuelve a pedir noticias/destacadas/ticker
  // solo, cada tantos minutos — el mismo intervalo que el administrador
  // configuró para que se actualicen los feeds RSS (Configuración →
  // "Intervalo de actualización RSS"), para que el visitante nunca tenga
  // que apretar F5 a mano para ver lo último.
  // ------------------------------------------------------------------

  var idIntervaloAutorefresco = null;
  var INTERVALO_AUTOREFRESCO_POR_DEFECTO_MIN = 30; // mismo default que configuracion.intervalo_rss_minutos

  function refrescarContenidoAutomatico() {
    // Si la pestaña está en segundo plano no tiene sentido gastar pedidos
    // de red: el próximo tick, cuando vuelva a estar visible, igual va a
    // traer lo último.
    if (document.visibilityState !== 'visible') {
      return;
    }
    cargarNoticias();
    actualizarSeccionDestacada();
    cargarUltimasNoticias();
    cargarPublicidadesSidebar();
    cargarTickerClimaDolar();
  }

  function configurarAutorefresco(intervaloMinutos) {
    var minutos = parseInt(intervaloMinutos, 10);
    if (!Number.isFinite(minutos) || minutos <= 0) {
      minutos = INTERVALO_AUTOREFRESCO_POR_DEFECTO_MIN;
    }
    if (idIntervaloAutorefresco) {
      clearInterval(idIntervaloAutorefresco);
    }
    idIntervaloAutorefresco = setInterval(refrescarContenidoAutomatico, minutos * 60 * 1000);
  }

  // ------------------------------------------------------------------
  // Reloj en vivo (formato argentino)
  // ------------------------------------------------------------------

  function actualizarReloj() {
    if (!elReloj) {
      return;
    }
    var ahora = new Date();
    var textoFecha;
    var textoHora;
    try {
      textoFecha = ahora.toLocaleDateString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
      textoHora = ahora.toLocaleTimeString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    } catch (error) {
      textoFecha = ahora.toDateString();
      textoHora = ahora.toTimeString();
    }
    var nombreLocalidad =
      (elSelectorLocalidad && elSelectorLocalidad.selectedOptions[0] && elSelectorLocalidad.selectedOptions[0].textContent) ||
      'La Plata';
    elReloj.textContent = nombreLocalidad + ', ' + textoFecha + ' · ' + textoHora;
    elReloj.setAttribute('datetime', ahora.toISOString());
  }

  // ------------------------------------------------------------------
  // Ticker de clima (por localidad elegida) y cotización del dólar
  // ------------------------------------------------------------------

  function cargarLocalidades() {
    if (!elSelectorLocalidad) {
      return;
    }
    obtenerJSON('/api/localidades')
      .then(function (localidades) {
        if (!Array.isArray(localidades) || localidades.length === 0) {
          return;
        }
        vaciar(elSelectorLocalidad);
        localidades.forEach(function (localidad) {
          var opcion = document.createElement('option');
          opcion.value = localidad.clave;
          opcion.textContent = localidad.nombre;
          elSelectorLocalidad.appendChild(opcion);
        });
        // Si la localidad guardada ya no existe en la lista (o nunca se
        // guardó ninguna), el <select> simplemente queda en la primera.
        elSelectorLocalidad.value = localidadClima;
        localidadClima = elSelectorLocalidad.value;
        actualizarReloj();
        cargarTickerClimaDolar();
      })
      .catch(function (error) {
        console.error('No se pudo cargar el listado de localidades.', error);
      });
  }

  function manejarCambioLocalidad() {
    localidadClima = elSelectorLocalidad.value;
    try {
      window.localStorage.setItem('localidad-clima', localidadClima);
    } catch (error) {
      // Sin storage disponible no pasa nada: solo no se recuerda para la próxima visita.
    }
    actualizarReloj();
    cargarTickerClimaDolar();
  }

  function configurarSelectorLocalidad() {
    if (!elSelectorLocalidad) {
      return;
    }
    elSelectorLocalidad.addEventListener('change', manejarCambioLocalidad);
  }

  function cargarTickerClimaDolar() {
    if (!elTickerClima && !elTickerDolar) {
      return;
    }
    var params = new URLSearchParams();
    params.set('localidad', localidadClima);
    obtenerJSON('/api/clima-dolar?' + params.toString())
      .then(function (datos) {
        if (elTickerClima) {
          if (datos && datos.clima) {
            elTickerClima.textContent =
              datos.clima.temperatura + '°C · Humedad ' + datos.clima.humedad +
              '% · Viento ' + datos.clima.viento + 'km/h';
            elTickerClima.hidden = false;
          } else {
            elTickerClima.hidden = true;
          }
        }
        if (elTickerDolar) {
          if (datos && datos.dolar) {
            elTickerDolar.textContent =
              'Dólar Oficial $' + datos.dolar.oficial.venta +
              ' · Dólar Blue $' + datos.dolar.blue.venta;
            elTickerDolar.hidden = false;
          } else {
            elTickerDolar.hidden = true;
          }
        }
      })
      .catch(function (error) {
        if (elTickerClima) elTickerClima.hidden = true;
        if (elTickerDolar) elTickerDolar.hidden = true;
        console.error('No se pudo cargar el ticker de clima/dólar.', error);
      });
  }

  // ------------------------------------------------------------------
  // Categorías
  // ------------------------------------------------------------------

  function crearBotonCategoria(etiqueta, valor) {
    var li = document.createElement('li');
    var boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'categoria-btn';
    boton.dataset.categoria = valor;
    boton.textContent = etiqueta;
    boton.setAttribute('aria-pressed', valor === estado.categoria ? 'true' : 'false');
    if (valor === estado.categoria) {
      boton.classList.add('activa');
    }
    boton.addEventListener('click', function () {
      seleccionarCategoria(valor);
    });
    li.appendChild(boton);
    return li;
  }

  function marcarCategoriaActiva(valor) {
    var botones = elListaCategorias.querySelectorAll('.categoria-btn');
    botones.forEach(function (boton) {
      var esActiva = boton.dataset.categoria === valor;
      boton.classList.toggle('activa', esActiva);
      boton.setAttribute('aria-pressed', esActiva ? 'true' : 'false');
    });
  }

  function seleccionarCategoria(valor) {
    // Se cancela cualquier búsqueda con debounce pendiente para que no
    // pise esta selección de categoría cuando termine de esperar sus 400ms.
    clearTimeout(temporizadorBusqueda);
    estado.modo = 'listado';
    estado.categoria = valor;
    estado.pagina = 1;
    estado.query = '';
    if (elInputBusqueda) {
      elInputBusqueda.value = '';
    }
    marcarCategoriaActiva(valor);
    cargarNoticias();
    actualizarSeccionDestacada();
    cargarUltimasNoticias();
  }

  function manejarCambioAntiguedad() {
    estado.pagina = 1;
    estado.periodo = elFiltroAntiguedad.value;
    cargarNoticias();
    cargarUltimasNoticias();
  }

  function configurarFiltroAntiguedad() {
    if (!elFiltroAntiguedad) {
      return;
    }
    elFiltroAntiguedad.addEventListener('change', manejarCambioAntiguedad);
  }

  function cargarCategorias() {
    if (!elListaCategorias) {
      return;
    }
    vaciar(elListaCategorias);
    elListaCategorias.appendChild(crearBotonCategoria('Todo', ''));
    CATEGORIAS_POR_DEFECTO.forEach(function (categoria) {
      elListaCategorias.appendChild(crearBotonCategoria(categoria, categoria));
    });

    // Se intenta reemplazar la lista fija por la oficial de la API;
    // si falla, se conserva la lista por defecto ya renderizada.
    obtenerJSON('/api/categorias')
      .then(function (categorias) {
        if (!Array.isArray(categorias) || categorias.length === 0) {
          return;
        }
        vaciar(elListaCategorias);
        elListaCategorias.appendChild(crearBotonCategoria('Todo', ''));
        categorias.forEach(function (categoria) {
          elListaCategorias.appendChild(crearBotonCategoria(categoria, categoria));
        });
      })
      .catch(function (error) {
        console.error('No se pudo obtener /api/categorias, se usa la lista por defecto.', error);
      });
  }

  // ------------------------------------------------------------------
  // Tarjetas de noticia (reutilizadas en destacada, grilla y sidebar)
  // ------------------------------------------------------------------

  function crearTarjetaNoticia(noticia, esDestacada) {
    var articulo = document.createElement('article');
    articulo.className = 'tarjeta-noticia' + (esDestacada ? ' tarjeta-destacada' : '');

    var enlace = document.createElement('a');
    enlace.className = 'tarjeta-enlace';
    enlace.href = noticia.link_original;
    enlace.target = '_blank';
    enlace.rel = 'noopener noreferrer';
    enlace.setAttribute(
      'aria-label',
      noticia.titulo + '. Fuente: ' + noticia.fuente_nombre + '. Se abre en una pestaña nueva.'
    );

    var imagenWrap = document.createElement('div');
    imagenWrap.className = 'tarjeta-imagen-wrap';
    var img = document.createElement('img');
    img.className = 'tarjeta-imagen';
    establecerImagenConFallback(img, noticia.imagen_url, 'Imagen de portada: ' + noticia.titulo, articulo);
    imagenWrap.appendChild(img);

    if (esDestacada) {
      var insignia = document.createElement('span');
      insignia.className = 'badge-destacada';
      insignia.textContent = 'Última hora';
      imagenWrap.appendChild(insignia);
    }

    var cuerpo = document.createElement('div');
    cuerpo.className = 'tarjeta-cuerpo';

    var categoriaSpan = document.createElement('span');
    categoriaSpan.className = 'tarjeta-categoria';
    categoriaSpan.textContent = noticia.categoria;

    var titulo = document.createElement(esDestacada ? 'h2' : 'h3');
    titulo.className = 'tarjeta-titulo';
    titulo.textContent = noticia.titulo;

    var resumen = document.createElement('p');
    resumen.className = 'tarjeta-resumen';
    resumen.textContent = noticia.resumen;

    var meta = document.createElement('div');
    meta.className = 'tarjeta-meta';
    var fuente = document.createElement('span');
    fuente.className = 'tarjeta-fuente';
    fuente.textContent = noticia.fuente_nombre;
    var fecha = document.createElement('span');
    fecha.className = 'tarjeta-fecha';
    fecha.textContent = formatearFechaRelativa(noticia.fecha_publicacion);
    fecha.title = formatearFechaCompleta(noticia.fecha_publicacion);
    meta.appendChild(fuente);
    meta.appendChild(fecha);

    cuerpo.appendChild(categoriaSpan);
    cuerpo.appendChild(titulo);
    cuerpo.appendChild(resumen);
    cuerpo.appendChild(meta);

    enlace.appendChild(imagenWrap);
    enlace.appendChild(cuerpo);
    articulo.appendChild(enlace);
    return articulo;
  }

  // ------------------------------------------------------------------
  // Noticia destacada
  // ------------------------------------------------------------------

  function actualizarMetaOg(noticia) {
    setMetaContenido('og:title', noticia.titulo);
    setMetaContenido('og:description', noticia.resumen);
    if (noticia.imagen_url) {
      setMetaContenido('og:image', noticia.imagen_url);
    }
  }

  function setMetaContenido(propiedad, valor) {
    if (!valor) {
      return;
    }
    var el = document.querySelector('meta[property="' + propiedad + '"]');
    if (el) {
      el.setAttribute('content', valor);
    }
  }

  /**
   * Las noticias destacadas son una selección editorial global (la marca
   * el administrador desde el panel, sin categoría propia), no algo que
   * tenga sentido por sección: si se dejaran visibles al filtrar por una
   * categoría, se verían noticias de otras secciones mezcladas ahí
   * arriba aunque el resto de la página sí filtre bien, dando la
   * impresión de que el filtro "no hizo nada". Por eso solo se muestran
   * en la vista general ("Todo", sin categoría ni búsqueda activa).
   */
  function actualizarSeccionDestacada() {
    if (!elSeccionDestacada) {
      return;
    }
    var mostrar = estado.modo === 'listado' && estado.categoria === '';
    elSeccionDestacada.hidden = !mostrar;
    if (mostrar) {
      cargarDestacada();
    } else {
      vaciar(elSeccionDestacada);
      // Se saca la clase para que no compita con la regla CSS
      // ".seccion-destacada:empty" (display:none) que la oculta.
      elSeccionDestacada.classList.remove('destacadas-grid');
    }
  }

  var MAX_DESTACADAS = 3;

  /**
   * Intenta cargar una URL de imagen en un <img> descartable, sin
   * insertarlo en la página. Se usa para saber, ANTES de mostrar una
   * tarjeta destacada, si su imagen realmente va a cargar — así se evita
   * el parpadeo de mostrar la tarjeta y sacarla un instante después
   * (como pasaba antes), y se puede calcular de una sola vez cuántos
   * huecos quedan libres para rellenar con publicidad.
   * @param {string} url
   * @returns {Promise<boolean>}
   */
  function precargarImagen(url) {
    return new Promise(function (resolve) {
      if (!url) {
        resolve(false);
        return;
      }
      var img = new Image();
      img.onload = function () {
        resolve(true);
      };
      img.onerror = function () {
        resolve(false);
      };
      img.src = url;
    });
  }

  /**
   * Completa hasta `cantidad` huecos de la grilla de destacadas con
   * publicidades de la posición "destacada" (a pedido del
   * administrador: si no hay suficientes noticias destacadas con
   * imagen, ese espacio arriba de todo no debe quedar vacío ni
   * desbalanceado, se llena con publicidad en vez de eso).
   * @param {number} cantidad
   */
  function rellenarDestacadasConPublicidad(cantidad) {
    if (cantidad <= 0) {
      return;
    }
    obtenerJSON('/api/publicidades?posicion=destacada')
      .then(function (publicidades) {
        if (!Array.isArray(publicidades) || publicidades.length === 0) {
          return;
        }
        publicidades.slice(0, cantidad).forEach(function (publicidad) {
          elSeccionDestacada.appendChild(crearTarjetaPublicidad(publicidad));
          registrarImpresion(publicidad.id);
        });
      })
      .catch(function (error) {
        console.error('No se pudieron cargar las publicidades de relleno de destacadas.', error);
      });
  }

  function cargarDestacada() {
    if (!elSeccionDestacada) {
      return;
    }
    vaciar(elSeccionDestacada);
    elSeccionDestacada.classList.add('destacadas-grid');
    for (var i = 0; i < MAX_DESTACADAS; i++) {
      var esqueleto = document.createElement('div');
      esqueleto.className = 'tarjeta-skeleton tarjeta-skeleton-destacada';
      esqueleto.setAttribute('aria-hidden', 'true');
      var imagenEsqueleto = document.createElement('div');
      imagenEsqueleto.className = 'skeleton skeleton-imagen';
      esqueleto.appendChild(imagenEsqueleto);
      elSeccionDestacada.appendChild(esqueleto);
    }

    obtenerJSON('/api/noticias/destacada')
      .then(function (destacadas) {
        // El servidor manda más candidatas (CANDIDATOS_DESTACADA en
        // routes/publico.js) de las que se van a mostrar (MAX_DESTACADAS):
        // se precargan todas en paralelo y se toman, en el mismo orden de
        // prioridad que mandó el servidor, las primeras 3 cuya imagen
        // carga bien — así alcanza con que 3 de las 8 candidatas tengan
        // una imagen válida, no las 3 primeras puntuales.
        var lista = Array.isArray(destacadas) ? destacadas : [];
        return Promise.all(lista.map(function (noticia) {
          return precargarImagen(noticia.imagen_url);
        })).then(function (resultados) {
          var conImagenOk = lista.filter(function (noticia, indice) {
            return resultados[indice];
          });
          return conImagenOk.slice(0, MAX_DESTACADAS);
        });
      })
      .then(function (destacadasConImagen) {
        vaciar(elSeccionDestacada);
        destacadasConImagen.forEach(function (noticia) {
          elSeccionDestacada.appendChild(crearTarjetaNoticia(noticia, true));
        });
        if (destacadasConImagen[0]) {
          actualizarMetaOg(destacadasConImagen[0]);
        }
        rellenarDestacadasConPublicidad(MAX_DESTACADAS - destacadasConImagen.length);
      })
      .catch(function (error) {
        vaciar(elSeccionDestacada);
        console.error('No se pudo cargar las noticias destacadas.', error);
      });
  }

  // ------------------------------------------------------------------
  // Grilla principal de noticias (listado con filtro por categoría, o búsqueda)
  // ------------------------------------------------------------------

  function mostrarEsqueletosGrilla(cantidad) {
    vaciar(elGrilla);
    elGrilla.setAttribute('aria-busy', 'true');
    for (var i = 0; i < cantidad; i++) {
      var tarjeta = document.createElement('div');
      tarjeta.className = 'tarjeta-skeleton';
      tarjeta.setAttribute('aria-hidden', 'true');

      var imagen = document.createElement('div');
      imagen.className = 'skeleton skeleton-imagen';

      var linea1 = document.createElement('div');
      linea1.className = 'skeleton skeleton-linea skeleton-linea-corta';

      var linea2 = document.createElement('div');
      linea2.className = 'skeleton skeleton-linea';

      var linea3 = document.createElement('div');
      linea3.className = 'skeleton skeleton-linea';

      tarjeta.appendChild(imagen);
      tarjeta.appendChild(linea1);
      tarjeta.appendChild(linea2);
      tarjeta.appendChild(linea3);
      elGrilla.appendChild(tarjeta);
    }
  }

  function mostrarMensajeEstado(tipo, texto) {
    elMensajeEstado.hidden = false;
    elMensajeEstado.textContent = texto;
    elMensajeEstado.className = 'mensaje-estado' + (tipo ? ' ' + tipo : '');
  }

  function ocultarMensajeEstado() {
    elMensajeEstado.hidden = true;
    elMensajeEstado.textContent = '';
    elMensajeEstado.className = 'mensaje-estado';
  }

  function renderizarPaginacion(pagina, totalPaginas) {
    vaciar(elPaginacion);
    if (!totalPaginas || totalPaginas <= 1) {
      return;
    }

    var anterior = document.createElement('button');
    anterior.type = 'button';
    anterior.className = 'paginacion-btn';
    anterior.textContent = 'Anterior';
    anterior.disabled = pagina <= 1;
    anterior.addEventListener('click', function () {
      cambiarPagina(pagina - 1);
    });

    var indicador = document.createElement('span');
    indicador.className = 'paginacion-indicador';
    indicador.textContent = 'Página ' + pagina + ' de ' + totalPaginas;

    var siguiente = document.createElement('button');
    siguiente.type = 'button';
    siguiente.className = 'paginacion-btn';
    siguiente.textContent = 'Siguiente';
    siguiente.disabled = pagina >= totalPaginas;
    siguiente.addEventListener('click', function () {
      cambiarPagina(pagina + 1);
    });

    elPaginacion.appendChild(anterior);
    elPaginacion.appendChild(indicador);
    elPaginacion.appendChild(siguiente);
  }

  function cambiarPagina(nuevaPagina) {
    estado.pagina = nuevaPagina;
    cargarNoticias();
    var contenido = document.getElementById('contenido-principal');
    if (contenido && contenido.scrollIntoView) {
      contenido.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderizarNoticias(datos) {
    vaciar(elGrilla);
    elGrilla.setAttribute('aria-busy', 'false');
    var noticias = (datos && Array.isArray(datos.noticias)) ? datos.noticias : [];

    if (noticias.length === 0) {
      var textoVacio = estado.modo === 'busqueda'
        ? 'No encontramos noticias para "' + estado.query + '".'
        : 'No hay noticias disponibles en esta categoría por el momento.';
      mostrarMensajeEstado('vacio', textoVacio);
      renderizarPaginacion(0, 0);
      return;
    }

    ocultarMensajeEstado();
    noticias.forEach(function (noticia) {
      elGrilla.appendChild(crearTarjetaNoticia(noticia, false));
    });
    renderizarPaginacion(datos.pagina || estado.pagina, datos.totalPaginas || 1);
  }

  function cargarNoticias() {
    mostrarEsqueletosGrilla(6);
    ocultarMensajeEstado();
    vaciar(elPaginacion);

    var promesa;
    if (estado.modo === 'busqueda') {
      var paramsBusqueda = new URLSearchParams();
      paramsBusqueda.set('q', estado.query);
      paramsBusqueda.set('pagina', String(estado.pagina));
      if (estado.periodo) {
        paramsBusqueda.set('periodo', estado.periodo);
      }
      promesa = obtenerJSON('/api/buscar?' + paramsBusqueda.toString());
    } else {
      var paramsListado = new URLSearchParams();
      paramsListado.set('pagina', String(estado.pagina));
      if (estado.categoria) {
        paramsListado.set('categoria', estado.categoria);
      }
      if (estado.periodo) {
        paramsListado.set('periodo', estado.periodo);
      }
      promesa = obtenerJSON('/api/noticias?' + paramsListado.toString());
    }

    promesa
      .then(function (datos) {
        renderizarNoticias(datos);
      })
      .catch(function (error) {
        vaciar(elGrilla);
        elGrilla.setAttribute('aria-busy', 'false');
        mostrarMensajeEstado('error', 'No pudimos conectar con el servidor. Probá de nuevo en unos minutos.');
        vaciar(elPaginacion);
        console.error('Error al cargar noticias.', error);
      });
  }

  // ------------------------------------------------------------------
  // Buscador (debounce 400ms)
  // ------------------------------------------------------------------

  function ejecutarBusquedaDesdeInput() {
    var texto = elInputBusqueda.value.trim();
    if (texto === '') {
      // Sin texto de búsqueda: se vuelve al listado general (categoría "Todo"),
      // para que el filtro de categoría quede consistente con lo que se ve marcado.
      estado.modo = 'listado';
      estado.categoria = '';
      estado.query = '';
      estado.pagina = 1;
      marcarCategoriaActiva('');
      cargarNoticias();
      actualizarSeccionDestacada();
      cargarUltimasNoticias();
      return;
    }
    estado.modo = 'busqueda';
    estado.categoria = ''; // la búsqueda es siempre sobre todo el portal, no sobre la sección que hubiera activa
    estado.query = texto;
    estado.pagina = 1;
    marcarCategoriaActiva(''); // en modo búsqueda no hay categoría "activa" visualmente distinta a "Todo"
    cargarNoticias();
    actualizarSeccionDestacada();
    cargarUltimasNoticias();
  }

  function configurarBusqueda() {
    if (!elFormBusqueda || !elInputBusqueda) {
      return;
    }
    elInputBusqueda.addEventListener('input', function () {
      clearTimeout(temporizadorBusqueda);
      temporizadorBusqueda = setTimeout(ejecutarBusquedaDesdeInput, 400);
    });
    elFormBusqueda.addEventListener('submit', function (evento) {
      evento.preventDefault();
      clearTimeout(temporizadorBusqueda);
      ejecutarBusquedaDesdeInput();
    });
  }

  // ------------------------------------------------------------------
  // Sidebar: últimas 10 noticias
  // ------------------------------------------------------------------

  function crearItemCompacto(noticia) {
    var li = document.createElement('li');
    li.className = 'item-compacto';

    var enlace = document.createElement('a');
    enlace.className = 'item-compacto-enlace';
    enlace.href = noticia.link_original;
    enlace.target = '_blank';
    enlace.rel = 'noopener noreferrer';
    enlace.setAttribute('aria-label', noticia.titulo + '. Fuente: ' + noticia.fuente_nombre + '. Se abre en una pestaña nueva.');

    var titulo = document.createElement('span');
    titulo.className = 'item-compacto-titulo';
    titulo.textContent = noticia.titulo;

    var meta = document.createElement('span');
    meta.className = 'item-compacto-meta';
    meta.textContent = noticia.fuente_nombre + ' · ' + formatearFechaRelativa(noticia.fecha_publicacion);

    enlace.appendChild(titulo);
    enlace.appendChild(meta);
    li.appendChild(enlace);
    return li;
  }

  function cargarUltimasNoticias() {
    if (!elListaUltimas) {
      return;
    }
    vaciar(elListaUltimas);
    for (var i = 0; i < 5; i++) {
      var li = document.createElement('li');
      li.className = 'skeleton skeleton-linea';
      li.style.height = '2.2rem';
      li.setAttribute('aria-hidden', 'true');
      elListaUltimas.appendChild(li);
    }

    // Respeta la sección y el período activos: si hay una categoría o un
    // filtro de antigüedad elegidos, el "Últimas noticias" de la barra
    // lateral muestra las últimas de ese recorte, no las últimas de todo
    // el portal (mismo criterio que la grilla principal).
    var paramsUltimas = new URLSearchParams();
    paramsUltimas.set('pagina', '1');
    paramsUltimas.set('limite', '10');
    if (estado.modo === 'listado' && estado.categoria) {
      paramsUltimas.set('categoria', estado.categoria);
    }
    if (estado.periodo) {
      paramsUltimas.set('periodo', estado.periodo);
    }

    obtenerJSON('/api/noticias?' + paramsUltimas.toString())
      .then(function (datos) {
        vaciar(elListaUltimas);
        var noticias = (datos && Array.isArray(datos.noticias)) ? datos.noticias.slice(0, 10) : [];
        if (noticias.length === 0) {
          var liVacio = document.createElement('li');
          liVacio.className = 'mensaje-vacio-compacto';
          liVacio.textContent = 'No hay noticias disponibles.';
          elListaUltimas.appendChild(liVacio);
          return;
        }
        noticias.forEach(function (noticia) {
          elListaUltimas.appendChild(crearItemCompacto(noticia));
        });
      })
      .catch(function (error) {
        vaciar(elListaUltimas);
        var liError = document.createElement('li');
        liError.className = 'mensaje-vacio-compacto';
        liError.textContent = 'No se pudieron cargar las últimas noticias.';
        elListaUltimas.appendChild(liError);
        console.error('Error al cargar las últimas noticias.', error);
      });
  }

  // ------------------------------------------------------------------
  // Sidebar: publicidades
  // ------------------------------------------------------------------

  function registrarImpresion(id) {
    enviarPost('/api/publicidades/' + id + '/impresion');
  }

  function registrarClick(id) {
    enviarPost('/api/publicidades/' + id + '/click');
  }

  function crearTarjetaPublicidad(publicidad) {
    var enlace = document.createElement('a');
    enlace.className = 'publicidad-item';
    enlace.href = publicidad.link_destino;
    enlace.target = '_blank';
    enlace.rel = 'noopener noreferrer sponsored';
    enlace.setAttribute('aria-label', 'Publicidad: ' + publicidad.nombre + '. Se abre en una pestaña nueva.');

    var etiqueta = document.createElement('span');
    etiqueta.className = 'publicidad-etiqueta';
    etiqueta.textContent = 'Publicidad';

    var img = document.createElement('img');
    establecerImagenConFallback(img, publicidad.imagen_url, 'Publicidad: ' + publicidad.nombre, enlace);

    enlace.appendChild(etiqueta);
    enlace.appendChild(img);

    // El click abre el destino de forma nativa (href + target="_blank");
    // el registro del click se dispara en paralelo, sin bloquear la navegación.
    enlace.addEventListener('click', function () {
      registrarClick(publicidad.id);
    });

    return enlace;
  }

  function cargarPublicidadesSidebar() {
    if (!elPublicidadesSidebar) {
      return;
    }
    vaciar(elPublicidadesSidebar);

    obtenerJSON('/api/publicidades?posicion=sidebar')
      .then(function (publicidades) {
        vaciar(elPublicidadesSidebar);
        if (!Array.isArray(publicidades) || publicidades.length === 0) {
          return; // No hay espacios contratados: la sección queda vacía, sin mensaje de error.
        }
        publicidades.forEach(function (publicidad) {
          elPublicidadesSidebar.appendChild(crearTarjetaPublicidad(publicidad));
          registrarImpresion(publicidad.id);
        });
      })
      .catch(function (error) {
        vaciar(elPublicidadesSidebar);
        console.error('No se pudieron cargar las publicidades.', error);
      });
  }

  // ------------------------------------------------------------------
  // Suscripción por mail
  // ------------------------------------------------------------------

  function mostrarMensajeSuscripcion(tipo, texto) {
    if (!elSuscripcionMensaje) return;
    elSuscripcionMensaje.hidden = false;
    elSuscripcionMensaje.textContent = texto;
    elSuscripcionMensaje.className = 'suscripcion-mensaje' + (tipo ? ' ' + tipo : '');
  }

  function configurarSuscripcion() {
    if (!elFormSuscripcion || !elInputSuscripcionEmail) {
      return;
    }
    elFormSuscripcion.addEventListener('submit', function (evento) {
      evento.preventDefault();
      var email = elInputSuscripcionEmail.value.trim();
      if (!email) {
        mostrarMensajeSuscripcion('error', 'Ingresá tu email.');
        return;
      }

      var boton = elFormSuscripcion.querySelector('.suscripcion-boton');
      if (boton) boton.disabled = true;

      obtenerJSON('/api/suscriptores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      })
        .then(function (respuesta) {
          mostrarMensajeSuscripcion('exito', (respuesta && respuesta.mensaje) || 'Revisá tu mail para confirmar.');
          elInputSuscripcionEmail.value = '';
        })
        .catch(function (error) {
          mostrarMensajeSuscripcion('error', error.message || 'No pudimos completar la suscripción.');
        })
        .then(function () {
          if (boton) boton.disabled = false;
        });
    });
  }

  // ------------------------------------------------------------------
  // Logo / botón de inicio: reinicia filtros y vuelve al listado general
  // ------------------------------------------------------------------

  function configurarLogo() {
    if (!elLogoInicio) {
      return;
    }
    elLogoInicio.addEventListener('click', function () {
      clearTimeout(temporizadorBusqueda);
      estado.modo = 'listado';
      estado.categoria = '';
      estado.periodo = '';
      estado.query = '';
      estado.pagina = 1;
      if (elInputBusqueda) {
        elInputBusqueda.value = '';
      }
      if (elFiltroAntiguedad) {
        elFiltroAntiguedad.value = '';
      }
      marcarCategoriaActiva('');
      cargarNoticias();
      actualizarSeccionDestacada();
      cargarUltimasNoticias();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ------------------------------------------------------------------
  // Inicialización
  // ------------------------------------------------------------------

  function iniciar() {
    cargarTema();

    actualizarReloj();
    setInterval(actualizarReloj, 1000);

    cargarCategorias();
    actualizarSeccionDestacada();
    cargarNoticias();
    cargarUltimasNoticias();
    cargarPublicidadesSidebar();
    cargarLocalidades(); // dispara la primera carga del ticker de clima/dólar al resolver
    setInterval(cargarTickerClimaDolar, 10 * 60 * 1000); // se refresca cada 10 minutos

    configurarBusqueda();
    configurarLogo();
    configurarFiltroAntiguedad();
    configurarSelectorLocalidad();
    configurarSuscripcion();
  }

  iniciar();
})();
