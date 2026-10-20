/**
 * Where the match alerts remember what they last saw: the score and status of
 * every match in play, so the next check can tell what changed.
 *
 * One Firestore document holds all of it — a few hundred matches at the busiest
 * — so a check is one read and one write, well inside the free tier. The write
 * is conditional on the document not having changed since it was read: if two
 * checks overlap, only one of them sends, so nobody gets an alert twice.
 *
 * NOTIFY_STATE=memory keeps it in the process instead, for a local test run.
 */
const axios = require('axios');
const google = require('./google');

const projectId = () =>
  process.env.NOTIFY_STATE_PROJECT || process.env.FCM_PROJECT_ID;

const documentUrl = () =>
  `https://firestore.googleapis.com/v1/projects/${projectId()}/databases/(default)/documents/notifier/live`;

let memory = null;

const useMemory = () =>
  String(process.env.NOTIFY_STATE || '').toLowerCase() === 'memory';

/** The saved state and the version to save it back against; null state if none yet. */
async function load() {
  if (useMemory()) return { state: memory && memory.state, version: memory };
  try {
    const { data } = await axios.get(documentUrl(), {
      headers: await google.headers(projectId()),
      timeout: 8000,
    });
    const text =
      data.fields && data.fields.state && data.fields.state.stringValue;
    return { state: text ? JSON.parse(text) : null, version: data.updateTime };
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return { state: null, version: null };
    }
    throw error;
  }
}

/**
 * Saves [state] if nothing else saved since [version] was read. False when
 * another check got there first, in which case this one must not send.
 */
async function save(state, version) {
  if (useMemory()) {
    if (memory !== version) return false;
    memory = { state };
    return true;
  }
  const precondition = version
    ? { 'currentDocument.updateTime': version }
    : { 'currentDocument.exists': false };
  try {
    await axios.patch(
      documentUrl(),
      { fields: { state: { stringValue: JSON.stringify(state) } } },
      {
        headers: await google.headers(projectId()),
        params: precondition,
        timeout: 8000,
      },
    );
    return true;
  } catch (error) {
    const status = error.response && error.response.status;
    // FAILED_PRECONDITION (400) or ALREADY_EXISTS (409): another check won.
    if (status === 400 || status === 409) return false;
    throw error;
  }
}

module.exports = { load, save };
