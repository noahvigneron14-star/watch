const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'cagnotte.db');
const INCREMENT_VALUE = 0.01;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Erreur lors de la connexion à la base SQLite:', err.message);
    process.exit(1);
  }
});

const initializeDatabase = () => {
  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS cagnotte (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        balance REAL NOT NULL DEFAULT 0
      )`,
      (err) => {
        if (err) {
          console.error('Erreur lors de la création de la table:', err.message);
          process.exit(1);
        }
      }
    );

    db.get('SELECT balance FROM cagnotte WHERE id = 1', (err, row) => {
      if (err) {
        console.error('Erreur lors de la lecture de la balance:', err.message);
        process.exit(1);
      }

      if (!row) {
        db.run('INSERT INTO cagnotte (id, balance) VALUES (1, 0)', (insertErr) => {
          if (insertErr) {
            console.error('Erreur lors de l’initialisation de la cagnotte:', insertErr.message);
            process.exit(1);
          }
        });
      }
    });
  });
};

initializeDatabase();

app.get('/api/balance', (_req, res) => {
  db.get('SELECT balance FROM cagnotte WHERE id = 1', (err, row) => {
    if (err) {
      console.error('Erreur lors de la récupération de la balance:', err.message);
      return res.status(500).json({ error: 'Impossible de récupérer la cagnotte' });
    }

    res.json({ balance: row?.balance ?? 0 });
  });
});

app.post('/api/watch-ad', (_req, res) => {
  db.run('UPDATE cagnotte SET balance = balance + ?', [INCREMENT_VALUE], function (err) {
    if (err) {
      console.error('Erreur lors de la mise à jour de la cagnotte:', err.message);
      return res.status(500).json({ error: 'Impossible de mettre à jour la cagnotte' });
    }

    if (this.changes === 0) {
      return res.status(500).json({ error: 'Cagnotte introuvable' });
    }

    db.get('SELECT balance FROM cagnotte WHERE id = 1', (selectErr, row) => {
      if (selectErr) {
        console.error('Erreur lors de la récupération de la balance actualisée:', selectErr.message);
        return res.status(500).json({ error: 'Impossible de récupérer la cagnotte' });
      }

      res.json({ balance: row.balance, increment: INCREMENT_VALUE });
    });
  });
});

process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Serveur prêt sur http://localhost:${PORT}`);
});
