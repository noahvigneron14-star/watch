const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 3000;
const INCREMENT_VALUE = Number(process.env.INCREMENT_VALUE ?? 0.01);
const MIN_WITHDRAW = Number(process.env.MIN_WITHDRAW ?? 1.5);
const connectionString = process.env.DATABASE_URL || process.env.LOCAL_DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const KIWIWALL_SECRET = process.env.KIWIWALL_SECRET || null;

if (!connectionString) {
  console.error('DATABASE_URL (ou LOCAL_DATABASE_URL) est requis pour se connecter à Postgres.');
  process.exit(1);
}

const shouldUseSSL = !/localhost|127\.0\.0\.1/i.test(connectionString);
const pool = new Pool({
  connectionString,
  ssl: shouldUseSSL ? { rejectUnauthorized: false } : false,
});

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const initializeDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        balance NUMERIC NOT NULL DEFAULT 0
      )
    `);
  } catch (error) {
    console.error('Erreur lors de l’initialisation de la base Postgres:', error.message);
    process.exit(1);
  }
};

initializeDatabase();

const normalizeEmail = (email) => email.trim().toLowerCase();

const generateToken = (userId) =>
  jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentification requise' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
};

app.post('/api/signup', async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Mot de passe trop court (min. 6 caractères)' });
  }

  const safeEmail = normalizeEmail(email);

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, balance`,
      [safeEmail, passwordHash]
    );

    const user = rows[0];
    const token = generateToken(user.id);
    res.status(201).json({
      token,
      user: { email: user.email, balance: Number(user.balance) },
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email déjà utilisé' });
    }
    console.error('Erreur lors de la création du compte:', error.message);
    res.status(500).json({ error: 'Impossible de créer le compte' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  }

  try {
    const safeEmail = normalizeEmail(email);
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [safeEmail]);

    if (!rows.length) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    const user = rows[0];
    const passwordValid = await bcrypt.compare(password, user.password_hash);

    if (!passwordValid) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    const token = generateToken(user.id);
    res.json({ token, user: { email: user.email, balance: Number(user.balance) } });
  } catch (error) {
    console.error('Erreur lors de la connexion:', error.message);
    res.status(500).json({ error: 'Impossible de se connecter' });
  }
});

app.get('/api/balance', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT email, balance FROM users WHERE id = $1', [req.userId]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    const balance = Number(rows[0].balance);
    res.json({ email: rows[0].email, balance, canWithdraw: balance >= MIN_WITHDRAW });
  } catch (error) {
    console.error('Erreur lors de la récupération de la balance:', error.message);
    res.status(500).json({ error: 'Impossible de récupérer la cagnotte' });
  }
});

app.post('/api/watch-ad', authenticate, async (req, res) => {
  try {
    const { rowCount, rows } = await pool.query(
      'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
      [INCREMENT_VALUE, req.userId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    const balance = Number(rows[0].balance);
    res.json({ balance, increment: INCREMENT_VALUE, canWithdraw: balance >= MIN_WITHDRAW });
  } catch (error) {
    console.error('Erreur lors de la mise à jour de la cagnotte:', error.message);
    res.status(500).json({ error: 'Impossible de mettre à jour la cagnotte' });
  }
});

app.post('/api/withdraw', authenticate, async (req, res) => {
  try {
    const { rowCount, rows } = await pool.query(
      `UPDATE users
       SET balance = balance - $1
       WHERE id = $2 AND balance >= $1
       RETURNING balance`,
      [MIN_WITHDRAW, req.userId]
    );

    if (rowCount === 0) {
      return res.status(400).json({ error: `Solde insuffisant (minimum ${MIN_WITHDRAW} €)` });
    }

    const balance = Number(rows[0].balance);
    res.json({ balance, withdrawn: MIN_WITHDRAW, canWithdraw: balance >= MIN_WITHDRAW });
  } catch (error) {
    console.error('Erreur lors de la mise à jour de la cagnotte:', error.message);
    res.status(500).json({ error: 'Impossible d’effectuer le retrait' });
  }
});

app.post('/api/kiwiwall-callback', async (req, res) => {
  try {
    if (!KIWIWALL_SECRET) {
      console.error('KIWIWALL_SECRET non configuré');
      return res.status(500).send('Secret manquant');
    }

    const providedSecret = req.query.secret || req.body.secret;
    if (providedSecret !== KIWIWALL_SECRET) {
      return res.status(403).send('Signature invalide');
    }

    const rawSubId = req.body.subid || req.body.sub_id || req.body.user_id;
    const payoutRaw = req.body.amount ?? req.body.payout ?? req.body.reward;
    const payout = Number(payoutRaw);

    if (!rawSubId || Number.isNaN(payout) || payout <= 0) {
      return res.status(400).send('Paramètres invalides');
    }

    const userKey = rawSubId.includes('@') ? normalizeEmail(rawSubId) : rawSubId;
    const { rowCount } = await pool.query(
      'UPDATE users SET balance = balance + $1 WHERE email = $2',
      [payout, userKey]
    );

    if (rowCount === 0) {
      return res.status(404).send('Utilisateur introuvable');
    }

    console.log(`KiwiWall payout ${payout}€ pour ${userKey}`);
    res.send('OK');
  } catch (error) {
    console.error('Erreur KiwiWall callback:', error.message);
    res.status(500).send('Erreur serveur');
  }
});

const shutdown = () => {
  pool
    .end()
    .catch((error) => console.error('Erreur lors de la fermeture de la connexion Postgres:', error.message))
    .finally(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.listen(PORT, () => {
  console.log(`Serveur prêt sur http://localhost:${PORT}`);
});
