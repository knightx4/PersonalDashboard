/**
 * Job search capture bookmarklet.
 *
 * The general solution to reading an application form's questions.
 *
 * Fetching questions from an ATS only works for Greenhouse, because the
 * questions live behind the Apply button rather than on the posting page.
 * Workday and iCIMS will not give them up without a session at all. This runs
 * in your browser, inside your session, on the page you are already looking at,
 * so it works everywhere — including the hostile ones.
 *
 * It reads labels, not values. It never touches what you have typed, never
 * submits anything, and posts only the question text and the page URL.
 *
 * Authentication is your session cookie. There is no token in this URL, because
 * a token in a bookmarklet is a token in your browser history.
 */
(function () {
  var ORIGIN = '__APP_ORIGIN__';

  function text(node) {
    if (!node) return '';
    return (node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /** The label for a form control, by every mechanism HTML offers. */
  function labelFor(input) {
    if (input.getAttribute('aria-label')) return input.getAttribute('aria-label').trim();

    var labelledBy = input.getAttribute('aria-labelledby');
    if (labelledBy) {
      var parts = labelledBy
        .split(/\s+/)
        .map(function (id) {
          return text(document.getElementById(id));
        })
        .filter(Boolean);
      if (parts.length) return parts.join(' ');
    }

    if (input.id) {
      var explicit = document.querySelector('label[for="' + CSS.escape(input.id) + '"]');
      if (explicit) return text(explicit);
    }

    var wrapping = input.closest('label');
    if (wrapping) return text(wrapping);

    // Radio and checkbox groups carry the question on the fieldset legend.
    var fieldset = input.closest('fieldset');
    if (fieldset) {
      var legend = fieldset.querySelector('legend');
      if (legend) return text(legend);
    }

    // Last resort: the nearest preceding block of text in the same container.
    var container = input.parentElement;
    for (var depth = 0; container && depth < 3; depth += 1) {
      var candidate = container.querySelector('label, legend, .label, [class*="question"]');
      if (candidate && text(candidate)) return text(candidate);
      container = container.parentElement;
    }

    return '';
  }

  var inputs = document.querySelectorAll(
    'input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select',
  );

  var seen = {};
  var questions = [];

  for (var i = 0; i < inputs.length; i += 1) {
    var input = inputs[i];
    if (input.type === 'file') continue;
    var label = labelFor(input);
    if (!label) continue;
    // Radio groups repeat the same legend once per option.
    var key = label.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    questions.push({
      text: label,
      required: input.required || input.getAttribute('aria-required') === 'true',
      inputType: input.tagName === 'TEXTAREA' ? 'textarea' : input.type || input.tagName.toLowerCase(),
    });
  }

  if (questions.length === 0) {
    alert('Job search: no form questions found on this page.');
    return;
  }

  fetch(ORIGIN + '/api/jobs/capture', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: window.location.href, title: document.title, questions: questions }),
  })
    .then(function (response) {
      return response.json().then(function (data) {
        return { ok: response.ok, data: data };
      });
    })
    .then(function (result) {
      if (!result.ok) {
        alert('Job search: ' + (result.data.error || 'could not save.'));
        return;
      }
      alert(
        'Job search: saved ' +
          result.data.added +
          ' new question' +
          (result.data.added === 1 ? '' : 's') +
          (result.data.matchedRole ? ' to ' + result.data.matchedRole : ' — match it to a role in the app') +
          '.',
      );
    })
    .catch(function () {
      alert('Job search: could not reach the app. Are you signed in?');
    });
})();
