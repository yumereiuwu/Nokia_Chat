(function () {
  var currentUser = null;
  var currentConversationId = null;
  var currentConversationTitle = '';
  var lastMessageId = '0';
  var pollTimer = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function notice(text, isError) {
    byId('notice').className = isError ? 'error' : '';
    byId('notice').innerHTML = '';
    byId('notice').appendChild(document.createTextNode(text || ''));
  }

  function request(method, url, data, callback) {
    var xhr = new XMLHttpRequest();

    xhr.open(method, url, true);
    xhr.setRequestHeader('Accept', 'application/json');

    if (data !== null && data !== undefined) {
      xhr.setRequestHeader('Content-Type', 'application/json');
    }

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;

      var result = {};
      try {
        result = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch (e) {
        callback(new Error('Máy chủ trả về dữ liệu không hợp lệ.'));
        return;
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        callback(new Error(result.error || ('Lỗi HTTP ' + xhr.status)), result);
        return;
      }

      callback(null, result);
    };

    xhr.onerror = function () {
      callback(new Error('Không kết nối được máy chủ.'));
    };

    xhr.send(data === null || data === undefined
      ? null : JSON.stringify(data));
  }

  function showApp(user) {
    currentUser = user;
    byId('authPanel').style.display = 'none';
    byId('chatPanel').style.display = 'block';
    byId('currentUserLabel').innerHTML = '';
    byId('currentUserLabel').appendChild(
      document.createTextNode('Đang đăng nhập: @' + user.username)
    );
    notice('Đăng nhập thành công.');
    loadConversations();
  }

  function showAuth() {
    currentUser = null;
    byId('authPanel').style.display = 'block';
    byId('chatPanel').style.display = 'none';
  }

  function addButton(container, text, action) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'item';
    button.appendChild(document.createTextNode(text));
    button.onclick = action;
    container.appendChild(button);
  }

  function login(username, password) {
    request('POST', '/api/auth/login', {
      username: username,
      password: password
    }, function (err, result) {
      if (err) {
        notice(err.message, true);
        return;
      }
      showApp(result.user);
    });
  }

  byId('loginForm').onsubmit = function () {
    login(
      byId('loginUsername').value,
      byId('loginPassword').value
    );
    return false;
  };

  byId('registerForm').onsubmit = function () {
    request('POST', '/api/auth/register', {
      username: byId('registerUsername').value,
      displayName: byId('registerName').value,
      password: byId('registerPassword').value
    }, function (err, result) {
      if (err) {
        notice(err.message, true);
        return;
      }
      byId('registerPassword').value = '';
      showApp(result.user);
    });
    return false;
  };

  byId('logoutButton').onclick = function () {
    request('POST', '/api/auth/logout', null, function (err) {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      currentConversationId = null;
      byId('messages').innerHTML = '';
      showAuth();
      notice(err ? err.message : 'Bạn đã đăng xuất.', !!err);
    });
  };

  byId('searchForm').onsubmit = function () {
    var query = byId('searchInput').value.replace(/^\s+|\s+$/g, '');

    if (query.charAt(0) === '@') {
      query = query.substring(1);
    }

    request('GET', '/api/users/search?q=' + encodeURIComponent(query),
      null, function (err, result) {
        var container = byId('searchResults');
        container.innerHTML = '';

        if (err) {
          notice(err.message, true);
          return;
        }

        if (!result.users || result.users.length === 0) {
          notice('Không tìm thấy người dùng.');
          return;
        }

        var i;
        for (i = 0; i < result.users.length; i++) {
          (function (user) {
            addButton(
              container,
              '@' + user.username + ' — ' + user.displayName,
              function () {
                createDirect(user.username);
              }
            );
          })(result.users[i]);
        }

        notice('Tìm thấy ' + result.users.length + ' người dùng.');
      });

    return false;
  };

  function createDirect(username) {
    request('POST', '/api/conversations/direct', {
      username: username
    }, function (err, result) {
      if (err) {
        notice(err.message, true);
        return;
      }

      loadConversations();
      openConversation(
        result.conversation.id,
        '@' + username
      );
    });
  }

  function loadConversations() {
    request('GET', '/api/conversations', null, function (err, result) {
      var container = byId('conversationList');
      container.innerHTML = '';

      if (err) {
        notice(err.message, true);
        return;
      }

      if (!result.conversations || result.conversations.length === 0) {
        container.appendChild(
          document.createTextNode('Chưa có cuộc trò chuyện.')
        );
        return;
      }

      var i;
      for (i = 0; i < result.conversations.length; i++) {
        (function (conversation) {
          var other = conversation.otherUser;
          var title = other
            ? '@' + other.username
            : (conversation.title || 'Cuộc trò chuyện');

          if (conversation.lastMessage) {
            title += ' — ' + conversation.lastMessage.body;
          }

          addButton(container, title, function () {
            var name = other ? '@' + other.username : title;
            openConversation(conversation.id, name);
          });
        })(result.conversations[i]);
      }
    });
  }

  function openConversation(id, title) {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }

    currentConversationId = String(id);
    currentConversationTitle = title;
    lastMessageId = '0';

    byId('conversationTitle').innerHTML = '';
    byId('conversationTitle').appendChild(
      document.createTextNode(title)
    );
    byId('messages').innerHTML = '';
    byId('messageInput').value = '';

    loadMessages(true);
  }

  function addMessage(message) {
    var container = byId('messages');
    var item = document.createElement('div');
    var sender = document.createElement('strong');
    var body = document.createElement('div');

    item.className = 'message';

    sender.appendChild(document.createTextNode(
      String(message.senderId) === String(currentUser.id)
        ? 'Bạn'
        : currentConversationTitle
    ));

    body.appendChild(document.createTextNode(message.body));

    item.appendChild(sender);
    item.appendChild(body);
    container.appendChild(item);

    lastMessageId = String(message.id);
    container.scrollTop = container.scrollHeight;
  }

  function loadMessages(initial) {
    if (!currentConversationId) return;

    var conversationId = currentConversationId;
    var after = initial ? '0' : lastMessageId;

    request(
      'GET',
      '/api/conversations/' + encodeURIComponent(conversationId) +
        '/messages?after=' + encodeURIComponent(after),
      null,
      function (err, result) {
        if (conversationId !== currentConversationId) return;

        if (!err && result.messages) {
          var i;
          for (i = 0; i < result.messages.length; i++) {
            addMessage(result.messages[i]);
          }
        } else if (err) {
          notice(err.message, true);
        }

        // Chỉ lên lịch vòng tiếp theo sau khi yêu cầu hiện tại kết thúc,
        // tránh các truy vấn polling chồng lên nhau.
        pollTimer = setTimeout(function () {
          loadMessages(false);
        }, 5000);
      }
    );
  }

  byId('messageForm').onsubmit = function () {
    if (!currentConversationId) {
      notice('Hãy chọn người để nhắn tin.', true);
      return false;
    }

    var text = byId('messageInput').value;
    if (!text.replace(/\s/g, '')) return false;

    byId('sendButton').disabled = true;

    request(
      'POST',
      '/api/conversations/' +
        encodeURIComponent(currentConversationId) + '/messages',
      { body: text },
      function (err, result) {
        byId('sendButton').disabled = false;

        if (err) {
          notice(err.message, true);
          return;
        }

        byId('messageInput').value = '';
        if (result.message) addMessage(result.message);
        notice('Đã gửi tin nhắn.');
      }
    );

    return false;
  };

  // Tự khôi phục phiên nếu trình duyệt vẫn giữ cookie đăng nhập.
  request('GET', '/api/auth/me', null, function (err, result) {
    if (!err && result.authenticated) {
      showApp(result.user);
    } else {
      showAuth();
    }
  });
})();
