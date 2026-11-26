import express from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import QRCode from 'qrcode';
import os from 'os';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de multer para manejar uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Solo JPG, PNG y WEBP'));
    }
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/downloads', express.static('downloads'));

// Inicializar Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Función para limpiar archivos antiguos (mantener solo 30)
async function cleanOldFiles() {
  try {
    const downloadDir = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadDir)) return;
    
    const files = fs.readdirSync(downloadDir)
      .filter(file => file.startsWith('figura_') && file.endsWith('.png'))
      .map(file => ({
        name: file,
        path: path.join(downloadDir, file),
        time: fs.statSync(path.join(downloadDir, file)).mtime
      }))
      .sort((a, b) => b.time - a.time);
    
    if (files.length > 300) {
      const filesToDelete = files.slice(300);
      filesToDelete.forEach(file => {
        fs.unlinkSync(file.path);
        console.log('Archivo eliminado:', file.name);
      });
    }
  } catch (error) {
    console.error('Error limpiando archivos:', error);
  }
}

// Normaliza la imagen generada a 3:4
async function processImage(base64Image) {
  const buf = await sharp(Buffer.from(base64Image, 'base64'))
    .resize(1536, 2048, { fit: 'cover', position: 'center' })
    .png()
    .toBuffer();
  return buf.toString('base64');
}

// URL base pública (para que el QR funcione desde el celular)
function getBaseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const host = req.get('host');
  if (/^(localhost|127\.0\.0\.1)/.test(host)) {
    const port = host.split(':')[1] || PORT;
    for (const list of Object.values(os.networkInterfaces())) {
      for (const i of list) {
        if (i.family === 'IPv4' && !i.internal) return `http://${i.address}:${port}`;
      }
    }
  }
  return `${req.protocol}://${host}`;
}

// Escenas de colaboración humano + agente
const SCENES = [
  'la persona sentada en un taburete alto con una laptop abierta sobre las piernas, girada hacia el agente y gesticulando mientras le explica una idea; el agente de pie a su lado, inclinado hacia ella con una mano apoyada en su hombro',
  'la persona de pie sosteniendo una laptop bajo el brazo, riendo a mitad de una carcajada junto al agente, que está de pie a su lado con postura relajada y divertida',
  'la persona sentada en ángulo sobre una caja de madera clara con las piernas extendidas, tecleando en una laptop; el agente agachado a su lado mirando la pantalla con interés, como colaborador activo',
  'la persona sentada en una silla sencilla con la laptop sobre las rodillas, mirando segura y directo a la cámara; el agente de pie detrás de ella, apoyado en el respaldo, también mirando a la cámara',
  'la persona sentada sobre una pila de libros grandes, con la laptop abierta sobre las piernas, chocando los cinco con el agente, que está de pie frente a ella celebrando'
];

// Fondos de estudio de la marca (generados en Google Flow), se pasan como referencia del set
const BACKDROPS = [
  { name: 'gris claro', file: path.join(__dirname, 'public', 'img', 'fondos', 'estudio-gris.jpg') },
  { name: 'beige arena', file: path.join(__dirname, 'public', 'img', 'fondos', 'estudio-beige.jpg') },
  { name: 'rosa rubor', file: path.join(__dirname, 'public', 'img', 'fondos', 'estudio-rubor.jpg') }
];

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint para generar imagen
app.post('/api/generate', upload.single('image'), async (req, res) => {
  try {
    const agentId = parseInt(req.body.agent, 10);
    if (!(agentId >= 1 && agentId <= 10)) {
      return res.status(400).json({ error: 'Debes elegir un agente' });
    }
    const agentPath = path.join(__dirname, 'public', 'agents', `agent-${agentId}.jpg`);
    const scene = SCENES[Math.floor(Math.random() * SCENES.length)];
    const backdrop = BACKDROPS[Math.floor(Math.random() * BACKDROPS.length)];
    const prompt = `Tienes tres imágenes de referencia. La PRIMERA es una foto de una persona real. La SEGUNDA es un personaje 3D estilizado (el "agente" de monday.com). La TERCERA es el fondo de estudio (${backdrop.name}) que debes usar como set: mismo color, textura e iluminación.
Genera UNA sola fotografía nueva, vertical 3:4, al estilo de la campaña "Usuarios y agentes" de monday.com: ${scene}. Son compañeros de equipo (human + agent).

PERSONA (lo más importante: debe verse como una FOTOGRAFÍA REAL, no como ilustración ni render):
- Conserva con total fidelidad su identidad: forma del rostro, ojos, nariz, boca, cejas, tono de piel, edad, peinado, vello facial, lentes y complexión. Debe ser reconocible al instante como la misma persona.
- Fotorrealismo de cámara profesional: textura natural de la piel con poros y pequeñas imperfecciones, cabello con mechones individuales, brillo natural en los ojos, ropa con pliegues y textura de tela reales.
- NO piel plástica ni suavizada, NO filtro de belleza, NO estilo caricatura, 3D o pintura en la persona. Proporciones anatómicas correctas en manos y dedos.
- Expresión segura y auténtica: mirando directo a la cámara con confianza, o a mitad de una risa genuina con el agente. Nunca sorprendida ni rígida.
- Pose gráfica y ligeramente juguetona (en ángulo, piernas extendidas o cruzadas, cuerpo girado), NO un retrato corporativo rígido.
- Vestuario casual-cool: jeans, tenis, camiseta o camisa sencilla y una prenda exterior llamativa (chamarra, overshirt o blazer). Si en la foto se ve su ropa y encaja con este estilo, consérvala.

AGENTE: es un personaje 3D estilizado de la marca (formas suaves y exageradas, materiales mate tipo arcilla, colores saturados). Mantén su diseño, rostro, peinado, accesorios (audífonos, lentes), ropa, colores y estilo exactamente como en la referencia; NO lo conviertas en humano ni cambies su estilo. Es de cuerpo completo y aproximadamente de la misma estatura que una persona adulta. Actúa como colaborador activo (mira, señala, se inclina, toca el hombro), no como un muñeco o adorno.

CONTRASTE CLAVE de la marca: la persona es 100% fotografía real y el agente es 100% personaje 3D estilizado; conviven en la misma foto, con la misma luz y sombras de contacto en el piso, como si el agente estuviera físicamente ahí.

LAPTOP: la persona sostiene o usa una laptop plateada genérica (sin logotipo), inclinada hacia ella, como herramienta de trabajo compartida con el agente.

ESPÍRITU DE MARCA (valores de monday.com): la persona es la PROTAGONISTA y el logro es suyo; el agente está a su servicio, ayudándola a tener éxito, nunca le roba el protagonismo (la persona ligeramente más al frente o más centrada). Transmite confianza, cercanía y complicidad genuina entre ambos, y la energía de dos "constructores" creando algo juntos.

SET (mundo híbrido de monday.com, limpio como estudio):
- Fondo continuo de estudio sin costuras, plano y liso, igual al de la TERCERA imagen de referencia (${backdrop.name}). Sin paredes, sin techo, sin lámparas, sin oficina, sin decoración, sin formas gráficas.
- Atrezzo mínimo y simple solo si la escena lo pide: un taburete negro, una silla sencilla, una caja de madera o una pila de libros.
- Iluminación de estudio uniforme, brillante y limpia, con sombras suaves y controladas; plana y fresca, nada dramática ni melancólica. Colores naturales, con el agente aportando el color vibrante.
- Encuadre de cuerpo completo o 3/4, personajes centrados con aire alrededor. Grano fotográfico muy fino y sutil.

SIN TEXTO, SIN LETRAS, SIN LOGOS, SIN PALABRAS en ninguna parte de la imagen.`;

    if (!req.file) {
      return res.status(400).json({ error: 'La imagen es requerida' });
    }

    // Leer la imagen del usuario
    const imagePath = req.file.path;
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString('base64');

    // Configurar el modelo
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash-image"
    });

    // Preparar el contenido para la API
    const parts = [
      { text: prompt },
      { inlineData: { mimeType: req.file.mimetype, data: base64Image } },
      { inlineData: { mimeType: 'image/jpeg', data: fs.readFileSync(agentPath).toString('base64') } },
      { inlineData: { mimeType: 'image/jpeg', data: fs.readFileSync(backdrop.file).toString('base64') } }
    ];

    console.log('Generando retrato Human + Agent con Gemini 2.5...');
    
    // Generar la imagen
    const result = await model.generateContent(parts);
    const response = await result.response;

    // Buscar la imagen generada en la respuesta
    let generatedImageBase64 = null;
    
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        generatedImageBase64 = part.inlineData.data;
        break;
      }
    }

    // Limpiar el archivo temporal
    fs.unlinkSync(imagePath);

    if (generatedImageBase64) {
      // Procesar imagen: centrar, recortar y agregar marca de agua
      const processedImageBase64 = await processImage(generatedImageBase64);
      
      // Guardar imagen en carpeta downloads
      const filename = `figura_${Date.now()}.png`;
      const downloadPath = path.join(__dirname, 'downloads', filename);
      const downloadDir = path.join(__dirname, 'downloads');
      
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir);
      }
      
      fs.writeFileSync(downloadPath, Buffer.from(processedImageBase64, 'base64'));
      
      // Limpiar archivos antiguos
      await cleanOldFiles();
      
      // Generar URL de descarga
      const downloadUrl = `${getBaseUrl(req)}/d/${filename}`;
      console.log('URL de descarga generada:', downloadUrl);
      
      // Generar QR code
      const qrCode = await QRCode.toDataURL(downloadUrl);
      console.log('QR generado exitosamente, longitud:', qrCode.length);
      
      const response = {
        success: true,
        image: `data:image/png;base64,${processedImageBase64}`,
        downloadUrl: downloadUrl,
        qrCode: qrCode,
        message: 'Imagen generada y procesada exitosamente'
      };
      
      console.log('Respuesta enviada con QR:', !!response.qrCode);
      res.json(response);
    } else {
      res.status(500).json({
        error: 'No se pudo generar la imagen',
        details: 'La API no retornó una imagen'
      });
    }

  } catch (error) {
    console.error('Error al generar imagen:', error);
    
    // Limpiar archivo temporal en caso de error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      error: 'Error al generar la imagen',
      details: error.message
    });
  }
});

// Página móvil de descarga (destino del QR)
app.get('/d/:filename', (req, res) => {
  const f = path.basename(req.params.filename);
  if (!/^figura_\d+\.png$/.test(f) || !fs.existsSync(path.join(__dirname, 'downloads', f))) {
    return res.status(404).send('Imagen no encontrada');
  }
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tu retrato Human + Agent</title>
<style>
@font-face{font-family:Poppins;font-weight:500;src:url(/fonts-poppins/Poppins-Medium.ttf)}
@font-face{font-family:Poppins;font-weight:600;src:url(/fonts-poppins/Poppins-SemiBold.ttf)}
@font-face{font-family:Poppins;font-weight:700;src:url(/fonts-poppins/Poppins-Bold.ttf)}body{margin:0;background:#f5f6f8;font-family:Poppins,sans-serif;display:flex;flex-direction:column;align-items:center;min-height:100vh}
header{width:100%;background:#fff;padding:14px 18px;font-weight:700;font-size:1.2rem;color:#181b34;box-sizing:border-box;border-bottom:1px solid #eee}
header span{color:#00ca72}.card{margin:18px;background:#fff;border-radius:16px;padding:12px;box-shadow:0 4px 18px rgba(0,0,0,.08);max-width:420px;width:calc(100% - 36px);box-sizing:border-box}
img{width:100%;border-radius:10px;display:block}
a.btn{display:flex;align-items:center;justify-content:center;gap:8px;background:#6161ff;color:#fff;text-decoration:none;padding:14px;border-radius:10px;font-weight:600;margin-top:14px}</style></head>
<link rel="icon" type="image/png" href="/img/monday-icon.png">
<body><header><img src="/img/monday-logo-dark.png" alt="monday.com" style="height:34px;width:auto;display:block"></header>
<div class="card"><img src="/downloads/${f}" alt="Tu retrato">
<a class="btn" href="/download/${f}" download>⬇ Descargar imagen</a></div></body></html>`);
});

// Endpoint de salud
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Human + Agent Portrait API está funcionando',
    hasApiKey: !!process.env.GOOGLE_API_KEY
  });
});

// Endpoint para servir archivos de descarga
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'downloads', filename);
  
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: 'Archivo no encontrado' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`🤖 Human + Agent Portrait está listo`);
  
  if (!process.env.GOOGLE_API_KEY) {
    console.warn('⚠️  ADVERTENCIA: No se encontró GOOGLE_API_KEY en el archivo .env');
  }
});
