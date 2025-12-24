# Cagnotte Pub

Petite appli Express + SQLite avec une page statique.  
Chaque clic sur **« Regarde une pub »** ajoute 0,01 € à la cagnotte persistée en base.

## Installation

```bash
cd C:\Users\Noah\CascadeProjects\pub-cagnotte
npm install
```

## Lancer le projet

```bash
npm start
```

Ensuite ouvre ton navigateur sur [http://localhost:3000](http://localhost:3000).

## API

- `GET /api/balance` → retourne `{ balance }`
- `POST /api/watch-ad` → incrémente la balance de 0,01 et renvoie la nouvelle valeur

Les données sont stockées dans `data/cagnotte.db`.

## Structure

```
pub-cagnotte/
├── data/
│   └── cagnotte.db       # généré automatiquement
├── public/
│   └── index.html        # UI
├── server.js             # API + serveur statique
├── package.json
└── README.md
```
