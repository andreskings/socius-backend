import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import busquedasRouter from './routes/busquedas.js';
import candidatosRouter from './routes/candidatos.js';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/busquedas', busquedasRouter);
app.use('/candidatos', candidatosRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Error interno' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`SOCIUS API escuchando en http://localhost:${PORT}`));
