'use strict';
// Calendrier, tâches et vue d'ensemble des paiements.
const express = require('express');
const db = require('../../db');
const auth = require('../../lib/auth');
const C = require('../../lib/constants');
const U = require('../../lib/util');

const router = express.Router();

router.get('/calendrier', auth.requirePerm('calendar'), (req, res) => {
  const m = /^(\d{4})-(\d{2})$/.exec(req.query.mois || '');
  const now = new Date();
  const year = m ? Number(m[1]) : now.getFullYear();
  const month = m ? Number(m[2]) - 1 : now.getMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  const iso = (d) => d.toISOString().slice(0, 10);
  const p = { from: iso(first), to: iso(last) };
  let where = "event_date BETWEEN @from AND @to AND status NOT IN ('cancelled','archived')";
  if (!auth.can(req.user, 'requests.view_all')) { where += ' AND assigned_to = @me'; p.me = req.user.id; }
  const events = db.get().prepare(`SELECT id, reference, client_name, event_type, event_type_other, event_date, start_time, status, guests FROM requests WHERE ${where} ORDER BY event_date, start_time`).all(p);
  let tw = "due_date BETWEEN @from AND @to AND status <> 'done'";
  if (!auth.can(req.user, 'tasks.manage')) { tw += ' AND assignee_id = @me'; p.me = req.user.id; }
  const tasks = db.get().prepare(`SELECT id, title, due_date, request_id FROM tasks WHERE ${tw}`).all(p);
  const prev = new Date(Date.UTC(year, month - 1, 1));
  const next = new Date(Date.UTC(year, month + 1, 1));
  res.render('admin/calendar', {
    title: 'Calendrier', year, month, first, last, events, tasks,
    prevKey: iso(prev).slice(0, 7), nextKey: iso(next).slice(0, 7),
    monthLabel: first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  });
});

router.get('/taches', auth.requirePerm('tasks.manage', 'tasks.own'), (req, res) => {
  const all = auth.can(req.user, 'tasks.manage');
  const status = C.TASK_STATUSES[req.query.status] ? req.query.status : '';
  const rows = db.get().prepare(`SELECT t.*, u.name AS assignee, r.reference, r.event_date FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN requests r ON r.id = t.request_id
    WHERE 1=1 ${all ? '' : 'AND t.assignee_id = @me'} ${status ? 'AND t.status = @status' : "AND t.status <> 'done'"}
    ORDER BY t.due_date IS NULL, t.due_date, t.id`).all({ me: req.user.id, status });
  const users = db.get().prepare('SELECT id, name FROM users WHERE active = 1 ORDER BY name').all();
  const events = all ? db.get().prepare("SELECT id, reference, client_name, event_date FROM requests WHERE status NOT IN ('archived','cancelled','refused','expired') ORDER BY event_date IS NULL, event_date").all() : [];
  res.render('admin/tasks', { title: 'Tâches', rows, users, events, status, all });
});

function back(req, fallback) {
  const r = req.body.back;
  return typeof r === 'string' && /^\/admin\//.test(r) && !r.startsWith('//') ? r : fallback;
}

router.post('/taches', auth.requirePerm('tasks.manage'), (req, res) => {
  const title = U.str(req.body.title, 200);
  const requestId = U.intOrNull(req.body.request_id, 1);
  if (title) {
    db.get().prepare('INSERT INTO tasks (request_id, title, due_date, assignee_id) VALUES (?,?,?,?)')
      .run(requestId, title, /^\d{4}-\d{2}-\d{2}$/.test(req.body.due_date || '') ? req.body.due_date : null, U.intOrNull(req.body.assignee_id, 1));
    req.flash('ok', 'Tâche ajoutée.');
  }
  res.redirect(back(req, '/admin/taches'));
});

router.post('/taches/checklist', auth.requirePerm('tasks.manage'), (req, res) => {
  const r = db.get().prepare('SELECT id, event_date FROM requests WHERE id = ?').get(U.intOrNull(req.body.request_id, 1));
  if (r) {
    const ins = db.get().prepare('INSERT INTO tasks (request_id, title, due_date) VALUES (?,?,?)');
    db.tx(() => C.DEFAULT_CHECKLIST.forEach((t) => ins.run(r.id, t, r.event_date || null)));
    req.flash('ok', 'Liste de contrôle standard ajoutée.');
  }
  res.redirect(back(req, '/admin/taches'));
});

router.post('/taches/:id', auth.requirePerm('tasks.manage', 'tasks.own'), (req, res) => {
  const t = db.get().prepare('SELECT * FROM tasks WHERE id = ?').get(Number(req.params.id));
  const mine = t && t.assignee_id === req.user.id;
  if (!t || (!auth.can(req.user, 'tasks.manage') && !mine)) return res.status(404).send('Tâche introuvable.');
  if (req.body.delete === '1' && auth.can(req.user, 'tasks.manage')) {
    db.get().prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
  } else {
    const status = C.TASK_STATUSES[req.body.status] ? req.body.status : t.status;
    const assignee = auth.can(req.user, 'tasks.manage') && req.body.assignee_id !== undefined ? U.intOrNull(req.body.assignee_id, 1) : t.assignee_id;
    db.get().prepare("UPDATE tasks SET status = ?, assignee_id = ?, updated_at = datetime('now') WHERE id = ?").run(status, assignee, t.id);
  }
  res.redirect(back(req, '/admin/taches'));
});

router.get('/paiements', auth.requirePerm('payments.view'), (req, res) => {
  const rows = db.get().prepare(`SELECT p.*, r.reference, r.client_name, r.id AS rid FROM payments p JOIN requests r ON r.id = p.request_id ORDER BY p.paid_on DESC, p.id DESC LIMIT 300`).all();
  const balances = db.get().prepare(`SELECT r.id, r.reference, r.client_name, r.event_date, r.status, v.total_cents,
      (SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE request_id = r.id AND currency = 'USD') AS paid_usd,
      (SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE request_id = r.id AND currency = 'CDF') AS paid_cdf
    FROM requests r JOIN quotes q ON q.request_id = r.id
    JOIN quote_versions v ON v.quote_id = q.id AND v.state = 'sent'
    WHERE r.status IN ('accepted','sent') ORDER BY r.event_date`).all();
  res.render('admin/payments', { title: 'Paiements', rows, balances });
});

module.exports = router;
