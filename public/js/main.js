/**
 * La Huella — Portal público
 * JS vanilla, sin frameworks. Todo el contenido que viene de la API
 * (títulos, resúmenes, nombres de fuente, etc.) se inserta siempre con
 * textContent o asignando propiedades del DOM, nunca con innerHTML, porque
 * proviene de feeds RSS de terceros y no es contenido de confianza.
 */

(function () {
  'use strict';

  var IMAGEN_PLACEHOLDER = 'img/placeholder.svg';
  var CATEGORIAS_POR_DEFECTO = [
    'Policía Bonaerense',
    'Narcotráfico',
    'Accidentes',
    'Seguridad Vial',
    'Justicia',
    'General'
  ];

  // Estado de la vista de listado/búsqueda de noticias.
  var estado = {
    modo: 'listado', // 'listado' | 'busqueda'
    categoria: '',
    query: '',
    pagina: 1
  };

  var temporizadorBusqueda = null;

  // ------------------------------------------------------------------
  // Referencias al DOM (el script se carga con "defer", el DOM ya existe)
  // ------------------------------------------------------------------

  var elReloj = document.getElementById('reloj');
  var elListaCategorias = document.getElementById('lista-categorias');
  var elSeccionDestacada = document.getElementById('seccion-destacada');
  var elGrilla = document.getElementById('grilla-noticias');
  var elMensajeEstado = document.getElementById('mensaje-estado');
  var elPaginacion = document.getElementById('paginacion');
  var elListaUltimas = document.getElementById('lista-ultimas');
  var elPublicidadesSidebar = document.getElementById('publicidades-sidebar');
  var elListaFuentes = document.getElementById('lista-fuentes');
  var elFormBusqueda = document.getElementById('form-busqueda');
  var elInputBusqueda = document.getElementById('input-busqueda');
  var elLogoInicio = document.getElementById('logo-inicio');
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

  function establecerImagenConFallback(imgEl, urlOriginal, textoAlt) {
    imgEl.src = urlOriginal || IMAGEN_PLACEHOLDER;
    imgEl.alt = textoAlt;
    imgEl.loading = 'lazy';
    imgEl.onerror = function () {
      imgEl.onerror = null;
      imgEl.src = IMAGEN_PLACEHOLDER;
    };
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
    elReloj.textContent = 'La Plata, ' + textoFecha + ' · ' + textoHora;
    elReloj.setAttribute('datetime', ahora.toISOString());
  }

  // ------------------------------------------------------------------
  // Ticker de clima (La Plata) y cotización del dólar
  // ------------------------------------------------------------------

  function cargarTickerClimaDolar() {
    if (!elTickerClima && !elTickerDolar) {
      return;
    }
    obtenerJSON('/api/clima-dolar')
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
  }

  function cargarCategorias() {
    if (!elListaCategorias) {
      return;
    }
    vaciar(elListaCategorias);
    elListaCategorias.appendChild(crearBotonCategoria('Todas', ''));
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
        elListaCategorias.appendChild(crearBotonCategoria('Todas', ''));
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
    establecerImagenConFallback(img, noticia.imagen_url, 'Imagen de portada: ' + noticia.titulo);
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

  function cargarDestacada() {
    if (!elSeccionDestacada) {
      return;
    }
    vaciar(elSeccionDestacada);
    elSeccionDestacada.classList.add('destacadas-grid');
    for (var i = 0; i < 3; i++) {
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
        vaciar(elSeccionDestacada);
        if (!Array.isArray(destacadas) || destacadas.length === 0) {
          return;
        }
        destacadas.forEach(function (noticia) {
          elSeccionDestacada.appendChild(crearTarjetaNoticia(noticia, true));
        });
        actualizarMetaOg(destacadas[0]);
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
      promesa = obtenerJSON('/api/buscar?' + paramsBusqueda.toString());
    } else {
      var paramsListado = new URLSearchParams();
      paramsListado.set('pagina', String(estado.pagina));
      if (estado.categoria) {
        paramsListado.set('categoria', estado.categoria);
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
      // Sin texto de búsqueda: se vuelve al listado general (categoría "Todas"),
      // para que el filtro de categoría quede consistente con lo que se ve marcado.
      estado.modo = 'listado';
      estado.categoria = '';
      estado.query = '';
      estado.pagina = 1;
      marcarCategoriaActiva('');
      cargarNoticias();
      return;
    }
    estado.modo = 'busqueda';
    estado.query = texto;
    estado.pagina = 1;
    marcarCategoriaActiva(''); // en modo búsqueda no hay categoría "activa" visualmente distinta a "Todas"
    cargarNoticias();
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

    obtenerJSON('/api/noticias?pagina=1&limite=10')
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
  // Sidebar: fuentes activas
  // ------------------------------------------------------------------

  function cargarFuentes() {
    if (!elListaFuentes) {
      return;
    }
    vaciar(elListaFuentes);

    obtenerJSON('/api/fuentes')
      .then(function (fuentes) {
        vaciar(elListaFuentes);
        if (!Array.isArray(fuentes) || fuentes.length === 0) {
          var liVacio = document.createElement('li');
          liVacio.textContent = 'Sin fuentes activas por el momento.';
          elListaFuentes.appendChild(liVacio);
          return;
        }
        fuentes.forEach(function (fuente) {
          var li = document.createElement('li');
          if (fuente.sitio_web) {
            var enlace = document.createElement('a');
            enlace.href = fuente.sitio_web;
            enlace.target = '_blank';
            enlace.rel = 'noopener noreferrer';
            enlace.textContent = fuente.nombre;
            li.appendChild(enlace);
          } else {
            li.textContent = fuente.nombre;
          }
          elListaFuentes.appendChild(li);
        });
      })
      .catch(function (error) {
        vaciar(elListaFuentes);
        var liError = document.createElement('li');
        liError.textContent = 'No se pudo cargar el listado de fuentes.';
        elListaFuentes.appendChild(liError);
        console.error('Error al cargar fuentes.', error);
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
    establecerImagenConFallback(img, publicidad.imagen_url, 'Publicidad: ' + publicidad.nombre);

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
      estado.query = '';
      estado.pagina = 1;
      if (elInputBusqueda) {
        elInputBusqueda.value = '';
      }
      marcarCategoriaActiva('');
      cargarNoticias();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ------------------------------------------------------------------
  // Inicialización
  // ------------------------------------------------------------------

  function iniciar() {
    actualizarReloj();
    setInterval(actualizarReloj, 1000);

    cargarCategorias();
    cargarDestacada();
    cargarNoticias();
    cargarUltimasNoticias();
    cargarFuentes();
    cargarPublicidadesSidebar();
    cargarTickerClimaDolar();
    setInterval(cargarTickerClimaDolar, 10 * 60 * 1000); // se refresca cada 10 minutos

    configurarBusqueda();
    configurarLogo();
    configurarSuscripcion();
  }

  iniciar();
})();
