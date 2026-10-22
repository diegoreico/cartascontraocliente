# Cartas contra el Cliente

Juego de cartas del equipo de AI & Data Ops, al estilo de Cards Against Humanity. Cada persona juega desde su móvil o su portátil, hasta 20 por sala, en español, gallego o portugués.

Es una sola página HTML. Toda la lógica del juego vive en el navegador; lo único que hace falta es que cada persona reparta su "presencia" al resto de su sala. Eso se hace de una de dos formas:

- **Sin servidor (por defecto).** Los navegadores de la sala se conectan directamente entre sí por WebRTC, con [Trystero](https://github.com/dmotz/trystero). Para encontrarse usan relés Nostr públicos; las partidas no pasan por ellos. Así funciona en un hosting estático como Vercel o GitHub Pages.
- **Con servidor.** Un servidor Node muy pequeño (`server.js`) hace de sala por WebSocket. Es más fiable en redes que bloquean WebRTC y detecta antes a quien se va.

```
public/index.html            el juego completo (HTML, CSS y JS en un fichero)
public/vendor/trystero.mjs   Trystero 0.26.0 empaquetado (WebRTC entre navegadores)
server.js                    sirve la página en / y la sala en /ws (salud en /healthz)
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

## Sin servidor o con servidor

La línea `<meta name="cxc-server">` del `<head>` de `public/index.html` decide cómo se conecta la página:

- `content=""` (como está en el repo): sin servidor, por WebRTC entre navegadores.
- `content="/ws"`: el servidor que sirve la página. `server.js` lo pone solo al servir la página, así que en local, Docker o Kubernetes se usa siempre el servidor.
- `content="wss://cartas.example.com/ws"`: un servidor en otra dirección.

También se puede pasar en el enlace, `?server=wss://cartas.example.com/ws`, y el navegador lo recuerda; `?server=off` lo olvida y vuelve a WebRTC.

Limitaciones del modo sin servidor:

- Depende de relés Nostr públicos para que los navegadores se encuentren y de los servidores STUN públicos de Google y Cloudflare. No hay servidor TURN, así que en algunas redes de empresa o de móvil dos personas pueden no llegar a conectarse.
- Cada persona se conecta con todas las demás de la sala: con 20 personas son 19 conexiones por móvil.
- Si el anfitrión cierra la página, el relevo tarda unos 20 segundos (unos 8 con servidor).
- La sala de espera (la lista de salas abiertas) es común a todo el que abra la página.

## GitHub Pages

El workflow `.github/workflows/pages.yml` publica la carpeta `public/` en GitHub Pages en cada push a `main` (o a mano desde la pestaña *Actions*). Para activarlo, en el repositorio ve a *Settings → Pages* y en *Source* elige **GitHub Actions**. La página queda en `https://<usuario>.github.io/cartascontraocliente/`.

GitHub Pages solo sirve ficheros estáticos, así que el juego funciona en modo sin servidor (WebRTC). Si prefieres usar `server.js` desplegado en otro sitio, ver "Sin servidor o con servidor".

## Vercel

El sitio se despliega en Vercel, que sirve `public/` como página estática. Vercel no ejecuta `server.js` (no admite WebSocket de larga duración), así que, igual que en GitHub Pages, el juego funciona en modo sin servidor (WebRTC).

La página carga **Vercel Web Analytics** (`/_vercel/insights/script.js`) y **Speed Insights** (`/_vercel/speed-insights/script.js`). Para que recojan datos hay que activarlos en el proyecto de Vercel, en las pestañas *Analytics* y *Speed Insights*, y volver a desplegar. Fuera de Vercel (en local, Docker o GitHub Pages) esas rutas no existen y simplemente no se registra nada.

## Qué pasa si algo se cae

- Si se cae el móvil del anfitrión (o cierra la página), otra persona de la sala toma el relevo (unos 8 segundos con servidor, unos 20 sin él) y la partida sigue.
- Si se reinicia el servidor, los navegadores se reconectan solos y la partida continúa donde estaba: el estado viaja en la presencia del anfitrión.
- Si se cierran todas las páginas de una sala, esa partida se pierde.

## Cambiar las cartas

Las cartas están en `public/index.html`, en las listas `BLACK_T` (negras) y `WHITE_T` (blancas). Cada carta es una fila con sus tres idiomas: `["español", "galego", "português"]`. En las negras, cada hueco se escribe `___` y tiene que haber el mismo número de huecos en los tres idiomas. Los nombres del equipo están en `NAMES`.

Si cambias el número o el orden de las cartas, hazlo con ninguna partida en marcha: los jugadores se pasan las cartas por su posición en la lista.

## Seguridad

No hay usuarios ni contraseñas: cualquiera que llegue a la dirección puede ver las salas abiertas y entrar con un código. Si lo desplegáis en Internet, ponedlo detrás de vuestra VPN o de vuestro SSO.
