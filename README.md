# Cartas contra el Cliente

Juego de cartas del equipo de AI & Data Ops, al estilo de Cards Against Humanity. Cada persona juega desde su móvil o su portátil, hasta 20 por sala, en español, gallego o portugués.

Es una sola página HTML más un servidor Node muy pequeño que hace de sala en tiempo real por WebSocket. Toda la lógica del juego vive en el navegador; el servidor solo reparte la "presencia" de cada persona al resto de su sala.

```
public/index.html   el juego completo (HTML, CSS y JS en un fichero)
server.js           sirve la página en / y la sala en /ws (salud en /healthz)
Dockerfile          imagen lista para desplegar
k8s.yaml            Deployment + Service + Ingress de ejemplo
```

## Arrancarlo en local

Hace falta Node 18 o superior.

```bash
npm install
npm start            # http://localhost:8080
```

Abre la dirección en varios navegadores o móviles de la misma red, crea una sala en uno y entra con el código en los demás. El puerto se cambia con `PORT=3000 npm start`.

## Docker

```bash
docker build -t cartas-cliente .
docker run -p 8080:8080 cartas-cliente
```

## Kubernetes

1. Sube la imagen a vuestro registro y cambia `image:` en `k8s.yaml`.
2. Cambia el host del Ingress (y activa el bloque `tls` si tenéis certificado).
3. `kubectl apply -f k8s.yaml`

Notas:

- **Una sola réplica.** Las salas viven en la memoria del proceso. Con varias réplicas, dos personas podrían caer en servidores distintos y no verse.
- El Ingress necesita permitir WebSocket con conexiones largas. Con ingress-nginx basta con las anotaciones de timeout del ejemplo.
- Con HTTPS la página se conecta sola por `wss://`.

## Página y servidor en sitios distintos

Por defecto la página se conecta al mismo servidor que la sirve (`/ws`). Si quieres alojar `index.html` en otro sitio (un hosting estático, por ejemplo), pon la dirección del servidor en esta línea del `<head>`:

```html
<meta name="cxc-server" content="wss://cartas.example.com/ws">
```

## GitHub Pages

El workflow `.github/workflows/pages.yml` publica la carpeta `public/` en GitHub Pages en cada push a `main` (o a mano desde la pestaña *Actions*). Para activarlo, en el repositorio ve a *Settings → Pages* y en *Source* elige **GitHub Actions**. La página queda en `https://<usuario>.github.io/cartascontraocliente/`.

GitHub Pages solo sirve ficheros estáticos, así que **no puede alojar el servidor de salas** (`server.js`). Para jugar desde Pages, el servidor tiene que estar desplegado en otro sitio (Docker, Kubernetes, Render, Fly.io…) con HTTPS, y la página tiene que saber dónde está. Hay dos formas:

- Fijarlo para todos: pon la dirección en `<meta name="cxc-server" content="wss://tu-servidor/ws">` en `public/index.html`.
- Pasarlo en el enlace: `https://<usuario>.github.io/cartascontraocliente/?server=wss://tu-servidor/ws`. El navegador lo recuerda para las siguientes visitas.

Sin servidor configurado, la página de Pages carga pero avisa de que no puede conectar con el servidor del juego.

## Vercel

El sitio se despliega en Vercel, que sirve `public/` como página estática. Igual que en GitHub Pages, Vercel no ejecuta `server.js` (no admite WebSocket de larga duración), así que el servidor de salas tiene que estar en otro sitio y la página tiene que conocer su dirección (`?server=` o `<meta name="cxc-server">`, ver arriba).

La página carga **Vercel Web Analytics** (`/_vercel/insights/script.js`) y **Speed Insights** (`/_vercel/speed-insights/script.js`). Para que recojan datos hay que activarlos en el proyecto de Vercel, en las pestañas *Analytics* y *Speed Insights*, y volver a desplegar. Fuera de Vercel (en local, Docker o GitHub Pages) esas rutas no existen y simplemente no se registra nada.

## Qué pasa si algo se cae

- Si se cae el móvil del anfitrión (o cierra la página), otra persona de la sala toma el relevo en unos 8 segundos y la partida sigue.
- Si se reinicia el servidor, los navegadores se reconectan solos y la partida continúa donde estaba: el estado viaja en la presencia del anfitrión.
- Si se cierran todas las páginas de una sala, esa partida se pierde.

## Cambiar las cartas

Las cartas están en `public/index.html`, en las listas `BLACK_T` (negras) y `WHITE_T` (blancas). Cada carta es una fila con sus tres idiomas: `["español", "galego", "português"]`. En las negras, cada hueco se escribe `___` y tiene que haber el mismo número de huecos en los tres idiomas. Los nombres del equipo están en `NAMES`.

Si cambias el número o el orden de las cartas, hazlo con ninguna partida en marcha: los jugadores se pasan las cartas por su posición en la lista.

## Seguridad

No hay usuarios ni contraseñas: cualquiera que llegue a la dirección puede ver las salas abiertas y entrar con un código. Si lo desplegáis en Internet, ponedlo detrás de vuestra VPN o de vuestro SSO.
