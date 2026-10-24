'use strict';
const express = require('express');
const db = require('../../db');
const auth = require('../../lib/auth');
const quotes = require('../../lib/quotes');
const U = require('../../lib/util');

const router = express.Router();

router.get('/', auth.requirePerm('dashboard'), (req, res) => {
  quotes.expireOldQuotes();
  const q = (sql, ...p) => db.get().prepare(sql).all(...p);
  const n = (sql, ...p) => db.get().prepare(sql).get(...p).n;
  const u = req.user;
  const data = { title: 'Tableau de bord' };

  if (auth.can(u, 'requests.view_all')) {
    data.counts = {
      unseen: n('SELECT COUNT(*) AS n FROM requests WHERE seen_at IS NULL'),
      pending: n("SELECT COUNT(*) AS n FROM requests WHERE status IN ('pending_validation','draft_generated','new')"),
      editing: n("SELECT COUNT(*) AS n FROM requests WHERE status = 'editing'"),
      toSend: n("SELECT COUNT(*) AS n FROM requests WHERE status = 'approved'"),
      sent: n("SELECT COUNT(*) AS n FROM requests WHERE status = 'sent'"),
      accepted: n("SELECT COUNT(*) AS n FROM requests WHERE status = 'accepted'"),
      refused: n("SELECT COUNT(*) AS n FROM requests WHERE status = 'refused'"),
    };
    data.toValidate = q(`SELECT r.id, r.reference, r.client_name, r.event_type, r.event_type_other, r.event_date, r.status, r.created_at, r.seen_at,
        v.total_cents, v.has_unconfirmed
      FROM requests r LEFT JOIN quotes qu ON qu.request_id = r.id
      LEFT JOIN quote_versions v ON v.quote_id = qu.id AND v.version_no = (SELECT MAX(version_no) FROM quote_versions WHERE quote_id = qu.id)
      WHERE r.status IN ('new','draft_generated','pending_validation','editing','approved') ORDER BY r.created_at DESC LIMIT 12`);
    data.upcoming = q(`SELECT id, reference, client_name, event_type, event_type_other, event_date, start_time, status, guests FROM requests
      WHERE event_date >= date('now') AND status IN ('accepted','sent','approved') ORDER BY event_date LIMIT 8`);
  } else {
    data.mine = q(`SELECT id, reference, client_name, event_type, event_type_other, event_date, status FROM requests
      WHERE assigned_to = ? AND status NOT IN ('archived','cancelled') ORDER BY event_date`, u.id);
  }
  data.myTasks = q(`SELECT t.*, r.reference FROM tasks t LEFT JOIN requests r ON r.id = t.request_id
    WHERE t.assignee_id = ? AND t.status <> 'done' ORDER BY t.due_date IS NULL, t.due_date LIMIT 10`, u.id);

  if (auth.can(u, 'payments.view')) {
    data.payments = {
      monthUsd: n("SELECT COALESCE(SUM(amount_cents),0) AS n FROM payments WHERE currency = 'USD' AND paid_on >= date('now','start of month')"),
      count: n("SELECT COUNT(*) AS n FROM payments WHERE paid_on >= date('now','start of month')"),
    };
  }
  if (auth.can(u, 'catalog.edit')) {
    data.provisionalTariffs = n('SELECT COUNT(*) AS n FROM tariffs WHERE active = 1 AND provisional = 1');
    data.noOwnerPhoto = !res.locals.s.founder_photo_media_id;
  }
  data.today = U.today();
  res.render('admin/dashboard', data);
});

module.exports = router;
