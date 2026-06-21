# MakerThing

A lightweight, self-hosted page builder. Create and publish multi-page websites using a drag-and-drop block editor — no frameworks, no node_modules, just Flask and vanilla JavaScript.

---

## Features

- Block-based page editor — Hero, Heading, Text, Image, Columns, Button, Divider
- Drag-and-drop and keyboard reordering (Alt + ↑/↓)
- Per-block inspector — alignment, padding, background colour, anchor ID
- Multi-page management with auto-save
- Dark mode via CSS custom properties
- Accessible — ARIA labels, live regions, skip link, full keyboard navigation
- Export pages as standalone HTML files
- SQLite by default, any SQLAlchemy-compatible DB in production

---

## Project Structure

```
makerthing/
├── app.py                  # Flask app, models, and routes
├── requirements.txt
├── .env                    # Local secrets (not committed)
├── models/
│   ├── __init__.py
│   └── page.py
├── routes/
│   ├── __init__.py
│   ├── api.py
│   └── ui.py
├── static/
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js          # Entry point / module coordinator
│       ├── model.js        # Flask API data layer
│       ├── editor.js       # Block lifecycle and UI
│       ├── preview.js      # Preview rendering
│       └── exporter.js     # HTML export
└── templates/
    ├── index.html          # Editor shell
    └── export.html         # Export template
```

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/your-username/makerthing.git
cd makerthing
```

### 2. Create and activate a virtual environment

```bash
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment variables

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

`.env` variables:

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | `dev-secret-change-in-prod` | Flask session secret — change in production |
| `DATABASE_URL` | `sqlite:///makerthing.db` | SQLAlchemy database URI |

### 5. Run the development server

```bash
python app.py
```

Open [http://localhost:5000](http://localhost:5000).

---

## API Reference

All endpoints are under `/api`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/pages` | List all pages |
| `POST` | `/api/pages` | Create a new page |
| `GET` | `/api/pages/<id>` | Get a single page with blocks |
| `PUT` | `/api/pages/<id>` | Update page title and blocks |
| `DELETE` | `/api/pages/<id>` | Delete a page |
| `GET` | `/api/pages/<id>/export` | Export page as standalone HTML |

### Page object

```json
{
  "id": "uuid",
  "title": "Home",
  "blocks": [
    {
      "type": "hero",
      "id": null,
      "background": null,
      "style": { "textAlign": "center", "padding": "32px" },
      "data": {
        "Hero headline": "Your headline here",
        "Hero subtext": "Describe your site."
      }
    }
  ],
  "created_at": "2025-01-01T00:00:00",
  "updated_at": "2025-01-01T00:00:00"
}
```

---

## Production Deployment

For production, swap SQLite for PostgreSQL by setting `DATABASE_URL`:

```
DATABASE_URL=postgresql://user:password@host:5432/makerthing
```

And serve with a proper WSGI server:

```bash
pip install gunicorn
gunicorn app:app
```

---

## Roadmap

- [ ] Rich text formatting toolbar
- [ ] Image upload to server / S3
- [ ] Custom CSS per page
- [ ] Page slug and SEO metadata
- [ ] User authentication
- [ ] One-click deploy to static hosting

---

## License

MIT
