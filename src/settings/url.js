const $ = (id) => document.getElementById(id);

const urlInput = $('urlInput');
const btnSave = $('btnSave');
const btnCancel = $('btnCancel');
const err = $('err');

function setError(text) {
  err.textContent = text || '';
}

btnCancel.addEventListener('click', () => window.close());

btnSave.addEventListener('click', async () => {
  setError('');
  const val = urlInput.value.trim();
  if (!val) return setError('Введи URL или ID');

  const res = await window.sproutgSettings.setWebUrl(val);
  if (!res || !res.ok) return setError(res?.error || 'Ошибка сохранения');
  window.close();
});

urlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') btnSave.click();
});
