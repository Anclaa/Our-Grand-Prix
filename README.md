# Our Grand Prix

**La carrera de nuestra historia** es un regalo de aniversario en español. El monoplaza #33 puede recorrer libremente una maqueta nocturna con cinco paradas, 20 fotos, música instrumental y una carta en la meta.

## Probar el regalo

Descomprime el ZIP y abre `index.html` en un navegador actualizado. Pulsa **Entrar al circuito** y espera a que se apaguen las cinco luces. La música empieza al pulsar el botón de entrada y se puede pausar con el icono de sonido.

- **Computadora**. Usa **W, A, S y D** o las **flechas** para conducir. **Espacio** frena y **Enter** abre el recuerdo al estar cerca. **M** alterna la vista panorámica.
- **Celular**. Mantén pulsados los controles en pantalla para acelerar o girar. El botón inferior con **↓** permite frenar y luego retroceder.
- **Pilotaje asistido**. El monoplaza recorre la pista y se detiene en cada parada descubierta durante la vuelta. Después de ver una foto o leer la historia, pulsa **Volver a la pista** para continuar.
- **Álbum**. Ahí quedan disponibles las fotos de las paradas abiertas. Tras visitar las cinco, vuelve a la parrilla para revelar la carta.
- **Volver a la pista**. El botón **↺** coloca el monoplaza en el punto más cercano del circuito. Los recuerdos abiertos permanecen disponibles durante esa vuelta.

El sitio usa WebGL cuando está disponible y una proyección 3D en Canvas como alternativa. Si el navegador no admite ninguna de las dos, el botón **Recorrer los recuerdos** permite abrir las fotos y la carta.

## Publicar en GitHub Pages

1. Descomprime `Our-Grand-Prix.zip`. Crea un repositorio público, por ejemplo `our-grand-prix`, o abre el que preparaste para esta página.
2. Abre **Add file → Upload files**. Sube el contenido del ZIP, con `index.html` y la carpeta `assets` en la raíz. Incluye todos los archivos JavaScript, `style.css` y `.nojekyll`.
3. Guarda los cambios en `main`. Si ya habías publicado la versión anterior, reemplaza los archivos existentes por los de este ZIP.
4. En **Settings → Pages**, elige **Deploy from a branch**, selecciona `main` y **/ (root)**, y pulsa **Save**.
5. Abre **Visit site** cuando termine el despliegue. Si usaste el mismo repositorio, el enlace de GitHub Pages es el mismo.

Con esa configuración de GitHub Pages, el sitio y las fotos son públicos. Para compartirlo en privado, también puedes enviar el ZIP y abrir `index.html` después de descomprimirlo.

[Guía oficial de publicación en GitHub Pages](https://docs.github.com/es/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## Personalizarla

- `recuerdos.js` contiene las historias y los pies de foto. Cada número apunta a `assets/recuerdo-NN.webp`. Las cinco miniaturas que decoran las paradas se guardan en `miniaturas.js`.
- `index.html` contiene el mensaje de la meta.
- Puedes reemplazar `assets/una-vuelta-contigo.mp3` por otro MP3 con el mismo nombre.

Inspiración de navegación por un mundo 3D tomada del [portafolio de Bruno Simon](https://bruno-simon.com/). La geometría, la interfaz y la composición musical de este regalo son originales. Three.js se distribuye con su licencia MIT en `assets/vendor`. Barlow Condensed e Inter incluyen sus licencias en `assets`.
