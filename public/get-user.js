// Fetch current user from backend and expose globally
function setUserSession(username) {
  window.currentUser = username;
  sessionStorage.setItem('username', username);
}

fetch('/api/me', { credentials: 'include' })
  .then(res => res.json())
  .then(data => {
    if (data && data.username) {
      setUserSession(data.username);
    }
  });

// Listen for login form submission and set session info
document.addEventListener('DOMContentLoaded', function() {
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.onsubmit = async function(e) {
      e.preventDefault();
      const username = loginForm.username.value;
      const password = loginForm.password.value;
      const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        credentials: 'include'
      });
      if (res.ok) {
        setUserSession(username);
      }
    };
  }
});
