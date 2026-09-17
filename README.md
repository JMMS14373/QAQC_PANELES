# QAQC Paneles — Explotación por Taladros Largos (ES / 中文)

Ficha digital de inspección QA/QC para paneles de explotación por taladros largos (long hole
stoping), construida a partir del archivo bilingüe del cliente
`FORMATO_QAQC_PANELES_Version_traducida.xlsx` — hoja **"Hoja3" (Versión 1.0)**, la versión vigente
de la ficha — y del marco normativo Decreto 1886 de 2015, modificado por el Decreto 944 de 2022
(Colombia).

No requiere build, ni Node, ni dependencias para desplegarse. Es una PWA instalable con tema
oscuro/naranja: además del HTML/JS incluye `manifest.json`, `sw.js` (service worker) e íconos,
para que el inspector pueda "Agregar a pantalla de inicio" en su celular/tablet y abrirla como
una app, incluso sin señal.

## Qué cambió en esta versión (v3 — reconciliada con la ficha y el maestro reales)

- **Estructura de la ficha actualizada según Hoja3**: 11 grupos de estándar y 67 ítems (antes 11
  grupos / 70 ítems de la hoja "QAQC PANELES" original). El grupo "Línea de vida" quedó unificado
  en uno solo ("6. Línea de vida Stope", antes estaba duplicado en derecha/izquierda), se agregó
  el grupo "9. Fase Cable Bolt" y se ajustó texto en varios ítems. Los grupos que en la ficha
  de Excel son condicionales (**Línea de vida Stope**: solo aplica si el panel es STOPE; **Voladura**:
  solo aplica durante carguío de explosivos; **4. Preparación del Frente**: solo aplica durante
  actividades de Producción, en Preparación se marca todo N/A) se muestran siempre en la app con
  una nota informativa bajo el título del grupo — el inspector los marca N/A cuando no aplican, en
  vez de ocultarlos automáticamente (así ningún grupo queda fuera del registro por error de
  detección).
- **Encabezado actualizado según Hoja3**: Fecha, Inspector, Empresa, Supervisor, Turno,
  Labor (panel), Operador de equipo, Guardia, Fase (Producción/Preparación), Código de equipo,
  Categoría de explotación (STOPE/UPPER) y Actividad. Reemplaza los campos de la versión anterior
  (Panel, Tipo de panel, Semana, Líder de turno, Supervisor mina, Operador/Contratista) — el rol de
  "líder de turno" ahora lo cubre el campo Supervisor (mismo listado), tal como se usa en campo.
- **Firmas**: se mantienen **3 firmantes** — Inspector, Supervisor y Operador de equipo — en vez
  del esquema de 2 responsables ("Inspector Proyectos Mina" / "Responsable Panel ZCNL") que
  aparece como borrador en el pie de Hoja3.
- **Autocompletado Categoría de explotación / Fase**: al elegir la Labor (panel) en un registro
  nuevo, si el maestro cargado trae esa relación, la app completa automáticamente si es STOPE o
  UPPER y si está en Producción o Preparación (editable igual, por si hace falta corregir).
- **Pestaña "Maestro / 主表" reconoce el archivo real `Maestro_Paneles.xlsx`**: ya no hace falta
  reformatear nada — puedes subir el archivo tal como lo manejan hoy. La app detecta automáticamente
  ese formato (por las columnas Name + Category del bloque de paneles), separa las listas
  correspondientes y deriva el tipo de panel (STOPE/UPPER) y la fase de cada uno a partir del
  nombre y la categoría. Si subes un archivo con otro formato, sigue funcionando la plantilla
  simple de esta app (una lista por columna) como respaldo — puedes descargarla desde la misma
  pestaña.
  - Reconoce tanto el formato anterior (una sola columna "Activity" y "Codigo") como el
    reorganizado en tablas con nombre (`tblPreparation`, `tblProduction`, `tblInspector`,
    `tblShift`, `tblContractor`, `tblGuard`, `tblSupervisor`, `tblMachine` con columna
    "Machine Codigo", `tblOperator`, `tblFronts`) — no importa cuál de los dos traiga el
    archivo, ambos se leen igual de bien.
  - **Actividad filtrada por Fase**: cuando el maestro trae las actividades separadas en dos
    tablas ("Preparation Activity" / "Production Activity", como en `tblPreparation` y
    `tblProduction`), el campo Actividad de "Nuevo registro" solo sugiere las que corresponden
    a la Fase ya elegida (Producción o Preparación) — al cambiar la Fase (a mano, o
    automáticamente al elegir la Labor/panel) la lista de sugerencias se actualiza sola. Si el
    maestro no trae esa separación (formato anterior, o los datos de ejemplo), el campo sigue
    mostrando todas las actividades juntas, como antes. La lista completa (unión de ambas)
    sigue guardada igual en la vista previa del Maestro y en la plantilla descargable.
  - Los códigos que trae el archivo (Inspector Code, Supervisor Code, Preparation/Production
    Code) por ahora solo se guardan internamente — el nombre sigue siendo lo único que se ve
    en los desplegables, el registro y el PDF, igual que hasta ahora para Inspector y
    Supervisor (Operador de equipo y Código de equipo sí muestran "Nombre — Código", como ya
    venían haciendo).
- **Actividades**: la lista de ejemplo de "Actividad" ahora trae las 43 actividades reales del
  ciclo de explotación tal como aparecen en el maestro (topografía, perforación, marcación, cable
  bolt, voladura, rellenos, etc.) — es contenido no sensible (nombres de tareas, no de personas),
  así que va incluido de fábrica; el resto del maestro de ejemplo (paneles, inspectores,
  supervisores, empresas, operadores) sigue siendo ficticio — ver "Privacidad" más abajo.
- **Tema oscuro industrial** (fondo `#0F1923`, acento naranja `#F2701D`, verde/rojo/gris para
  los estados), bilingüe ES/中文 en todo el formulario, igual que en versiones anteriores.
- **Exportación a Excel/CSV** desde la propia app: un registro individual o todo el archivo,
  con hoja `BD_Registros` (formato ancho, un registro por fila, con las nuevas columnas de
  encabezado) y hoja `Hallazgos_NC` (no conformidades con ID único y estado de cierre).
- **Exportación a PDF por registro**: botón "Descargar PDF / 下载PDF" en cada tarjeta del
  Archivo — genera un PDF bilingüe (ES/中文) con encabezado, los 11 grupos y 67 ítems con su
  estado (Cumple/No Cumple/N/A), observaciones, fotos y las 3 firmas — pensado como el
  entregable que el inspector comparte de su visita (ver detalle más abajo).
- 100% local al navegador del dispositivo (`localStorage`) — sin backend, pensado para
  desplegarse en GitHub Pages o cualquier hosting estático propio.

## Privacidad — qué SÍ y qué NO va al repositorio

- El código fuente (`index.html`) trae un maestro de **ejemplo** con nombres y paneles
  ficticios (Inspector Ejemplo 1, Panel_Ejemplo, etc.) — la única excepción es la lista de
  Actividades, que sí es la real (son nombres de tareas operativas, no datos personales).
- El maestro **real** de tu operación (paneles reales, nombres de inspectores, supervisores,
  empresas contratistas, operadores de equipo) **nunca se edita en el código ni se sube a git**:
  se carga desde la pestaña "Maestro / 主表" dentro de la app, y queda guardado únicamente en el
  `localStorage` del navegador/dispositivo donde lo cargaste. Cada inspector ve y usa el maestro
  que él mismo cargó en su propio dispositivo.
- Los registros de inspección (con evidencia fotográfica y firmas) también viven solo en
  `localStorage` de cada dispositivo — se comparten exportando a Excel/CSV, nunca se suben solos.

## Estructura de archivos

```
qaqc-paneles-app/
├── index.html               # estructura + estilos (tema oscuro/naranja) + datos de ejemplo
├── app.js                   # toda la lógica de la app (grupos, firmas, maestro, exportación)
├── manifest.json             # metadatos de instalación (nombre, ícono, colores)
├── sw.js                     # service worker: cachea el app shell para modo offline
├── README.md
├── fonts/
│   └── wqy-zenhei-subset.b64.js   # fuente china (subset) embebida en base64, para el PDF
└── icons/
    ├── icon-192.png
    ├── icon-512.png
    └── icon-maskable-512.png
```

Los archivos (`index.html`, `app.js`, `manifest.json`, `sw.js`, `fonts/`, `icons/`) deben quedar
en la MISMA carpeta al desplegar — el service worker solo puede cachear/controlar rutas dentro de
su propio directorio o por debajo de él.

## Qué incluye

- Encabezado de datos generales (fecha, inspector, empresa, supervisor, turno, labor/panel,
  operador de equipo, guardia, fase, código de equipo, categoría de explotación, actividad), con
  listas desplegables que vienen del **Maestro** (ejemplo por defecto, o el que cargues en la
  pestaña Maestro).
- Los 11 grupos de estándares y los 67 ítems (bilingües), con estado Cumple / No Cumple / N/A,
  observaciones y evidencia fotográfica. Los 2 grupos condicionales (Línea de vida Stope, Voladura)
  muestran una nota bilingüe indicando cuándo aplican.
- Captura de evidencia por cámara o galería, con compresión de la imagen en el propio
  dispositivo antes de guardarla.
- Firmas digitales a mano (Inspector, Supervisor, Operador de equipo) capturadas en `<canvas>`.
- Cálculo automático de % de cumplimiento por registro.
- **Pestaña Maestro / 主表**: carga el archivo real `Maestro_Paneles.xlsx` (formato de
  Activity/Inspector/Shift/Contractor/Guard/Supervisor/Machine name/Codigo/Operator name/Range/
  Name/Category/Active — detectado automáticamente) o la plantilla simple de esta app (una lista
  por columna: PANELES, TIPO_PANEL, TURNOS, GUARDIAS, INSPECTORES, SUPERVISORES, EMPRESAS,
  OPERADORES_EQUIPO, CODIGOS_EQUIPO, FASES, ACTIVIDADES, REFERENCIAS_MEDIDA). También puedes
  descargar una plantilla en blanco o restablecer a los datos de ejemplo. Se guarda en
  `localStorage` de ese navegador/dispositivo. La columna `REFERENCIAS_MEDIDA` alimenta la
  herramienta "Medir en la foto" (ver más abajo) — cada celda va en formato "Nombre = cm".
- **Exportación**: cada registro (o todo el archivo) se puede descargar como Excel (dos hojas:
  `BD_Registros` y `Hallazgos_NC` con fotos incrustadas cuando es posible) o como CSV si no hay
  internet — el Excel completo (SheetJS) se carga solo la primera vez que se necesita y solo si
  hay conexión; sin conexión, la exportación cae automáticamente a CSV (sin la hoja de
  hallazgos separada, ya que esa depende de tener varias hojas en un mismo archivo).
- **Exportación a PDF (descarga directa de archivo .pdf)**: en la pestaña Archivo, cada tarjeta
  de registro tiene un botón "Descargar PDF / 下载PDF" que genera y descarga un `.pdf` con todo
  el contenido del registro — encabezado, los 11 grupos con sus 67 ítems (estado, observaciones,
  fotos) y las 3 firmas — paginado automáticamente y completamente bilingüe ES/中文, pensado
  como el documento que el inspector entrega/comparte de su visita (por correo, WhatsApp, etc.).
  Se genera en el propio dispositivo con la librería jsPDF, que igual que el Excel completo se
  carga desde internet solo la primera vez que se usa (después queda en caché del navegador);
  sin conexión y sin haberla usado antes, el botón avisa que hace falta internet la primera vez.
  Funciona igual en celular/tablet (Android o iOS) que en computador: el navegador ofrece
  guardar/compartir el PDF generado. La descarga es manual (no automática al enviar el
  registro) — pensado para el flujo real: el inspector registra varias fichas bajo tierra sin
  señal, y ya en superficie, con señal, descarga y comparte los PDF.
- **Descargar todos los PDF (.zip)**: en la barra superior de Archivo, un botón descarga un
  único archivo `.zip` con un PDF por cada registro guardado — útil cuando el inspector hizo
  varias inspecciones en la misma salida y quiere compartirlas todas de una vez por correo, en
  vez de descargarlas una por una. Usa la misma librería jsPDF más JSZip (también diferida,
  solo requiere internet la primera vez).
- **Completar firmas pendientes (con límite de tiempo del turno)**: un registro se puede guardar
  aunque falte alguna firma (no es obligatorio firmar para enviar). Si falta una firma, la
  tarjeta del registro en Archivo muestra un aviso "Firma pendiente" y un botón "Completar
  firmas" que abre una ventana donde SOLO se puede dibujar la firma que faltaba (no se puede
  editar el resto del registro ni las firmas ya confirmadas) — pensado para el caso de firmar
  más tarde, cuando la persona correspondiente esté disponible (por ejemplo, ya en superficie).
  Esto solo es posible **dentro de la ventana del turno al que pertenece el registro**: turno
  día 06:00–17:59, turno noche 18:00–05:59 (del día siguiente), tomando la Fecha y el Turno
  guardados en ese registro. Pasada esa ventana, el botón se reemplaza por un aviso "Firma
  vencida" (deshabilitado) — no se puede completar después, para que los inspectores envíen su
  entregable (el PDF) al final de su turno y no queden firmas abiertas indefinidamente.
- **Fecha del registro y turno noche**: el campo Fecha toma por defecto la fecha del dispositivo,
  con un ajuste para el turno noche (18:00–05:59): entre medianoche y las 5:59 a.m. la fecha por
  defecto NO salta al día siguiente — se mantiene en el día en que arrancó ese turno noche, ya
  que se considera el mismo turno hasta las 6:00 a.m. El campo sigue siendo editable a mano si
  hace falta corregirlo.
- **Aviso de capacidad de almacenamiento**: como todo el archivo (fichas, fotos y firmas) vive en
  el almacenamiento del navegador de ese dispositivo (no hay un límite fijo tipo "carpeta", pero
  sí un cupo real del dispositivo), la pestaña Archivo muestra un aviso automático cuando el uso
  estimado llega al 70% (naranja) o al 90% (rojo), recordando exportar (PDF/Excel) y luego
  eliminar registros ya exportados para liberar espacio. Se puede eliminar un registro a la vez
  ("Eliminar" en cada tarjeta) o todos de una vez ("Eliminar todos los registros" en la barra
  superior, con confirmación) — siempre exporta antes de eliminar, ya que no hay forma de
  recuperar un registro borrado.
- **Contador de pasos (distancia estimada desde el ingreso)**: en "Nuevo registro", una tarjeta
  "Contador de pasos" con un botón "Iniciar ingreso a labor" arranca un conteo de pasos usando el
  sensor de movimiento del propio teléfono (acelerómetro vía `DeviceMotionEvent`) — **100% offline,
  no usa internet ni ninguna librería externa**, igual que el resto del formulario. Al tocar el botón
  de Cámara o Galería para documentar una condición, el conteo se **pausa automáticamente en ese
  instante** (antes de abrir la foto) para que el manejo del teléfono mientras el inspector está
  detenido (encuadrar, tomar la foto, escribir la observación) no sume pasos falsos; ese ítem queda
  con los pasos recorridos hasta ese punto (congelados por la pausa), y la app muestra un botón
  "▶ Reanudar conteo" que el inspector toca cuando retoma la caminata hacia el siguiente punto —
  el conteo NO se reanuda solo, es una decisión explícita del inspector para que el dato sea
  confiable. La distancia se calcula multiplicando por un "factor de calibración" (m/paso)
  configurable — el valor por defecto es 0.70, pero cada inspector puede ajustarlo al suyo propio
  (queda guardado en ese dispositivo; como referencia, la fórmula típica estatura×0.413 (mujeres) /
  ×0.415 (hombres) da resultados cercanos a ese valor por defecto). El número de pasos de cada ítem
  SIEMPRE queda editable a mano (aparece justo debajo de los botones de cámara/galería una vez que
  el ítem tiene evidencia), para que el inspector lo corrija con su propio criterio si el sensor se
  equivocó — por ejemplo por vibración de equipos cercanos o terreno irregular. Si el
  dispositivo/navegador no tiene el sensor disponible, o el inspector no otorga el permiso que pide
  iOS la primera vez, la app avisa y el campo de pasos se puede llenar completamente a mano (no
  bloquea nada, y en ese caso tampoco aparece el botón "Reanudar", ya que no hay sensor que
  reanudar). La distancia estimada de cada condición reportada queda guardada en el registro y se
  ve en el detalle de Archivo, en el PDF (junto a la evidencia) y en una columna del Excel (hoja
  `Hallazgos_NC`). **Importante**: no es un GPS ni un podómetro exacto — es una ayuda basada en
  detección de picos del acelerómetro, pensada para acercarse a la distancia real (como el cálculo
  mental "mis pasos × mi factor" que ya usan los inspectores), no para reemplazarlo.
  - **Sensibilidad en calibración, con indicador en pantalla**: en la primera versión, el umbral
    de detección era demasiado bajo — con el teléfono quieto en la mano (solo el pulso/temblor
    natural, o vibración de equipos cercanos bajo tierra) el contador seguía subiendo solo, como
    un cronómetro. Al subirlo se corrigió eso pero quedó demasiado alto para detectar zancadas
    reales de forma confiable — el punto exacto correcto depende del sensor de cada teléfono, así
    que en vez de seguir ajustando a ciegas, mientras el contador está activo aparece un indicador
    **"Sensibilidad del sensor — pico reciente"** junto al conteo, que muestra cada medio segundo
    qué tan fuerte fue el movimiento más marcado que captó el sensor, junto al umbral actual que
    se está usando para comparar. Sirve para calibrar con datos reales: parado quieto ese número
    debería quedar bastante por debajo del umbral; caminando normal, varias veces por encima. Si
    no es así, es la referencia que hace falta para ajustar `STEP_PEAK_THRESHOLD` en `app.js` al
    valor correcto para ese modelo de teléfono. Mientras se afina, el número de pasos de cada
    ítem siempre se puede corregir a mano — no depende de que el sensor quede perfecto.
  Además, la
  distancia queda como un pequeño pie de foto superpuesto directamente sobre la miniatura de la
  evidencia (📍≈X m), tanto al capturarla en el formulario como al revisarla en el detalle de
  Archivo — así queda inseparable de la foto a simple vista, sin necesidad de mezclarla con el
  texto libre de "Observaciones" (ese campo queda intacto para lo que el inspector quiera escribir).
- **Medir en la foto (escala a partir de un objeto de referencia)**: además de la distancia desde
  el ingreso, cada ítem con evidencia fotográfica tiene un botón "📏 Medir en la foto" que abre una
  ventana para estimar en centímetros el ancho, alto o largo de la condición reportada — pensado
  para reemplazar descripciones vagas ("muy ancho", "muy retirado") por un número, sin necesitar
  ningún sensor ni conexión. Funciona con la técnica clásica de campo: se marca en la misma foto un
  objeto cuya medida real ya se conoce (referencia) y luego el objeto que se quiere medir; la app
  calcula la escala en píxeles entre los dos y aplica esa escala a lo que se midió. Pasos:
  1. El inspector elige una **referencia** de una lista (ducto de ventilación, malla, u "Otro objeto
     / medida personalizada" si prefiere indicar el tamaño real él mismo, por ejemplo el de un
     extintor o una caja eléctrica visibles en la foto).
  2. Toca los dos extremos de esa referencia en la foto (Paso 1), y luego los dos extremos de lo
     que quiere medir (Paso 2). Si la referencia se repite varias veces en la línea marcada (por
     ejemplo 5 cuadros de malla seguidos), el campo "¿Cuántas veces se repite?" multiplica el
     tamaño de referencia (5 × 10 cm = 50 cm) antes de calcular la escala.
  3. La app muestra la medida estimada en cm y permite anotar opcionalmente qué se midió (ej.
     "Ancho de la grieta"); al guardar, queda junto al ítem, editable/rehacible en cualquier momento
     mientras el registro no se haya enviado.
  - **Limitación importante (misma que en el trabajo de campo con un martillo de escala)**: esta
    técnica solo es confiable si la referencia y el objeto medido están aproximadamente en el mismo
    plano/distancia de la cámara y la foto se tomó de frente (no en ángulo fuerte ni con zoom
    digital fuerte sobre un solo punto) — no es una medición topográfica exacta, es una **estimación
    de apoyo** para dar una cifra de referencia en vez de una descripción cualitativa. Por eso no se
    usa el ancho/alto de diseño de la labor (GA/CX) como referencia automática: las condiciones
    subestándar reportadas son justamente las que pueden desviarse de esas medidas de diseño.
  - **Lista de referencias editable desde el Maestro**: las referencias disponibles (nombre + cm)
    ya NO están fijas en el código — se leen de la nueva columna `REFERENCIAS_MEDIDA` del maestro
    (mismo archivo/plantilla que las demás listas desplegables), con el formato **"Nombre = cm"**
    por celda (ej. `Ducto de ventilación = 90`, `Malla (1 cuadro) = 10`). Así la operación puede
    agregar nuevas referencias con el tiempo (medida de extintor, caja eléctrica, patrón de
    barrenación estándar, etc.) sin tocar el código de la app — solo agregando filas a esa columna
    en el maestro y volviendo a cargarlo. Si no se carga un maestro propio, la app trae de ejemplo
    el ducto (90 cm) y la malla (10 cm).
  - La medida guardada (cm + qué se midió) se exporta igual que la distancia: aparece en el detalle
    de Archivo, en el PDF (junto a la evidencia) y en columnas propias de la hoja `Hallazgos_NC` del
    Excel.
- Todo el archivo de registros vive en `localStorage` de ese navegador — cada inspector ve y
  exporta SUS PROPIOS registros de ese dispositivo. No hay sincronización automática entre
  dispositivos todavía (ver más abajo).
- PWA instalable con soporte offline del "app shell": el `sw.js` cachea `index.html`, `app.js`,
  `manifest.json` y los íconos en la primera visita.
- **Nota importante:** el `sw.js` solo se registra cuando la página se sirve por `https://` (o
  `http://localhost` en pruebas locales) — los navegadores bloquean los service workers en
  `file://`. Si simplemente abres `index.html` con doble clic, la app funciona igual pero sin
  ese precaché.

## Flujo de trabajo recomendado (Maestro)

1. Una sola persona (por ejemplo, quien administra `Maestro_Paneles.xlsx` en el disco compartido)
   mantiene actualizado ese archivo con los paneles, turnos, personal y actividades vigentes.
2. Cada inspector abre la app en su propio celular/tablet, va a la pestaña **Maestro / 主表** y
   sube ese mismo archivo (tal cual, sin reformatear) con el botón "Cargar archivo maestro".
3. La app lo reconoce automáticamente, actualiza las listas desplegables en "Nuevo registro" y
   guarda esa copia en el dispositivo — queda vigente hasta que se vuelva a cargar una versión más
   reciente.
4. Este proceso es manual y por dispositivo (no hay sincronización automática todavía) — ver la
   sección siguiente para lo que se necesitaría para automatizarlo.

## Lo que falta para el objetivo final ("alimentar una base de datos general")

Con la pestaña Maestro y la exportación a Excel, ya no se necesita un backend para que cada
inspector capture datos reales y los comparta como archivo. Lo que SÍ sigue requiriendo un
backend es la sincronización automática y en tiempo real entre dispositivos (que el registro
que un inspector envía aparezca de inmediato en el celular de otro, o que el maestro se
actualice solo, sin exportar/importar/cargar archivos manualmente). Para eso se necesitaría:

1. Una API/base de datos donde "Enviar registro" haga un `POST` (además de guardarlo local), y
   donde la app pueda consultar el maestro vigente en vez de depender de una carga manual.
2. Opciones típicas: API propia (Node/Express, Python/FastAPI) sobre Postgres/MySQL, o un
   backend administrado tipo Firebase/Supabase.
3. Autenticación básica por inspector/turno.

El código ya está preparado para esa transición: `collectRecord()` en `app.js` arma el objeto
completo de un registro (encabezado + 11 grupos + firmas + fotos en base64) — ese es exactamente
el payload que se enviaría a una API real; el punto donde hoy se guarda en `localStorage`
(dentro del listener de `btnSubmit`) es el que habría que apuntar a esa API cuando esté lista.

## Pendiente (fuera de alcance de esta versión, a integrar más adelante)

- **Cierre del panel / relleno**: por ahora el relleno de cierre (pasta cementada, detrítico o
  mixto) se registra como 3 entradas más en la lista de Actividad, sin un grupo de verificación
  propio. Cuando se quiera cerrar todo el ciclo operativo, se puede sumar un grupo dedicado
  "Relleno del panel" con sus propios ítems de estándar.

## Desplegar en GitHub Pages

1. Crea un repositorio (o usa uno existente) y sube todo el contenido de esta carpeta a la raíz
   (o a una carpeta `/docs`).
2. En **Settings → Pages**, selecciona la rama y carpeta donde quedaron los archivos.
3. GitHub publica la URL en `https://<usuario>.github.io/<repo>/` — ábrela desde el celular o
   tablet del inspector para probarla en campo.
4. Antes de subir, confirma que `index.html` solo trae el maestro de **ejemplo** (ver
   "Privacidad" arriba) — nunca subas un `index.html` editado a mano con nombres reales.

## Ajustar contenido

- **Ítems y grupos bilingües**: variable `GRUPOS` inyectada al inicio de `index.html` (dentro
  del `<script>` antes de cargar `app.js`) — si el contenido de la ficha vuelve a cambiar,
  regenerar desde el Excel fuente es lo más seguro (evita errores de transcripción).
- **Maestro de ejemplo** (valores ficticios cuando nadie ha cargado uno real): variable
  `MASTER_DEFAULT`, mismo bloque.
- **Colores**: bloque `:root` al inicio del `<style>` en `index.html` (fondo `--paper`, acento
  `--accent`, etc.).
- **Maestro real de tu operación**: no se edita el código — se carga desde la pestaña
  "Maestro / 主表" dentro de la app, con el mismo archivo `Maestro_Paneles.xlsx` que ya usan, o la
  plantilla que la propia app permite descargar.
