(function () {
  var currentUser = null;
  var currentConversationId = null;
  var currentConversationTitle = '';
  var lastMessageId = '0';
  var peerLastReadMessageId = '0';
  var pollTimer = null;
  var listPollTimer = null;
  var soundEnabled = false;
  var knownLastMessageIds = {};
  var hasConversationSnapshot = false;

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

  function startConversationListPolling() {
    if (listPollTimer) {
      clearTimeout(listPollTimer);
      listPollTimer = null;
    }

    function refreshList() {
      if (!currentUser) return;

      loadConversations();

      listPollTimer = setTimeout(refreshList, 5000);
    }

    listPollTimer = setTimeout(refreshList, 5000);
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
    startConversationListPolling();
  }

  function showAuth() {
    currentUser = null;
    byId('authPanel').style.display = 'block';
    byId('chatPanel').style.display = 'none';
  }

  function addButton(container, text, action, unreadCount, avatarUrl, bio) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'item';

    if (avatarUrl) {
      var avatar = document.createElement('img');
      avatar.className = 'list-avatar';
      avatar.src = avatarUrl;
      avatar.alt = '';
      button.appendChild(avatar);
    }

    var label = document.createElement('span');
    label.appendChild(document.createTextNode(text));
    button.appendChild(label);

    if (bio) {
      var about = document.createElement('div');
      about.className = 'user-bio';
      about.appendChild(document.createTextNode(bio));
      button.appendChild(about);
    }

    if (unreadCount && unreadCount > 0) {
      var badge = document.createElement('span');
      badge.className = 'unread-badge';
      badge.appendChild(document.createTextNode(String(unreadCount)));
      button.appendChild(document.createTextNode(' '));
      button.appendChild(badge);
    }

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
      if (listPollTimer) {
        clearTimeout(listPollTimer);
        listPollTimer = null;
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
              },
              0,
              user.avatarUrl || '',
              user.bio || ''
            );

            var profileButton = document.createElement('button');
            profileButton.type = 'button';
            profileButton.className = 'profile-link-button';
            profileButton.appendChild(document.createTextNode('Xem hồ sơ'));
            profileButton.onclick = function () {
              showUserProfile(user.username);
            };
            container.appendChild(profileButton);
          })(result.users[i]);
        }

        notice('Tìm thấy ' + result.users.length + ' người dùng.');
      });

    return false;
  };

  function showUserProfile(username) {
    if (!username) return;

    request(
      'GET',
      '/api/users/' + encodeURIComponent(username) + '/profile',
      null,
      function (err, result) {
        if (err) {
          notice(err.message, true);
          return;
        }

        if (!result || !result.user) {
          notice('Không tải được hồ sơ người dùng.', true);
          return;
        }

        var user = result.user;
        var title = byId('conversationTitle');
        var panel = byId('publicProfilePanel');

        if (!panel) {
          panel = document.createElement('div');
          panel.id = 'publicProfilePanel';
          panel.className = 'public-profile-panel';
          title.parentNode.insertBefore(panel, title.nextSibling);
        }

        panel.innerHTML = '';

        var closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'profile-close-button';
        closeButton.appendChild(document.createTextNode('Đóng hồ sơ'));
        closeButton.onclick = function () {
          panel.style.display = 'none';
        };
        panel.appendChild(closeButton);

        if (user.avatarUrl) {
          var avatar = document.createElement('img');
          avatar.className = 'public-profile-avatar';
          avatar.src = user.avatarUrl;
          avatar.alt = 'Avatar của ' + user.username;

          var avatarLink = document.createElement('a');
          avatarLink.href = user.avatarUrl;
          avatarLink.target = '_blank';
          avatarLink.title = 'Mở ảnh đại diện kích thước đầy đủ';
          avatarLink.appendChild(avatar);
          panel.appendChild(avatarLink);
        }

        var displayName = document.createElement('h3');
        displayName.appendChild(document.createTextNode(
          user.displayName || user.username
        ));
        panel.appendChild(displayName);

        var usernameText = document.createElement('p');
        usernameText.className = 'public-profile-username';
        usernameText.appendChild(document.createTextNode('@' + user.username));
        panel.appendChild(usernameText);

        var bioText = document.createElement('p');
        bioText.className = 'public-profile-bio';
        bioText.appendChild(document.createTextNode(
          user.bio || 'Người dùng chưa thêm phần giới thiệu.'
        ));
        panel.appendChild(bioText);

        panel.style.display = 'block';
      }
    );
  }

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

  function playNotificationSound() {
    if (!soundEnabled) return;

    var audio = byId('notificationSound');
    if (!audio) return;

    // Dat am luong trinh phat o muc toi da.
    audio.volume = 1;

    try {
      audio.pause();
      audio.currentTime = 0;

      var playback = audio.play();

      if (playback && typeof playback.then === 'function') {
        playback.then(function () {}, function () {
          soundEnabled = false;
          var toggle = byId('soundToggle');
          if (toggle) toggle.innerHTML = 'Bật âm báo';
        });
      }
    } catch (e) {
      soundEnabled = false;
      var toggle = byId('soundToggle');
      if (toggle) toggle.innerHTML = 'Bật âm báo';
    }
  }

  function updateIncomingNotice(conversations) {
    var nextIds = {};
    var foundIncoming = false;
    var i;

    for (i = 0; i < conversations.length; i++) {
      var conversation = conversations[i];
      var key = String(conversation.id);
      var last = conversation.lastMessage;
      var lastId = last ? String(last.id) : '';
      var hadConversation = Object.prototype.hasOwnProperty.call(
        knownLastMessageIds, key
      );

      if (
        hasConversationSnapshot &&
        lastId &&
        last &&
        currentUser &&
        String(last.senderId) !== String(currentUser.id) &&
        (!hadConversation || knownLastMessageIds[key] !== lastId)
      ) {
        foundIncoming = true;
      }

      nextIds[key] = lastId;
    }

    knownLastMessageIds = nextIds;
    hasConversationSnapshot = true;

    // Chi phat mot tieng cho moi dot kiem tra,
    // ke ca khi nguoi dung dang mo cuoc tro chuyen.
    if (foundIncoming) {
      playNotificationSound();
    }
  }
  function loadConversations() {
    request('GET', '/api/conversations', null, function (err, result) {
      var container = byId('conversationList');
      container.innerHTML = '';

      if (err) {
        notice(err.message, true);
        return;
      }

      updateIncomingNotice(result.conversations || []);

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
          }, Number(conversation.unreadCount || 0), other ? other.avatarUrl : "", other ? other.bio : "");

          if (other) {
            var profileButton = document.createElement('button');
            profileButton.type = 'button';
            profileButton.className = 'profile-link-button';
            profileButton.appendChild(document.createTextNode('Xem hồ sơ'));
            profileButton.onclick = function () {
              showUserProfile(other.username);
            };
            container.appendChild(profileButton);
          }
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

  function isIdAtOrBelow(id, limit) {
    var a = String(id || '0').replace(/^0+/, '') || '0';
    var b = String(limit || '0').replace(/^0+/, '') || '0';

    if (a.length < b.length) return true;
    if (a.length > b.length) return false;
    return a <= b;
  }

  function updateMessageStatuses(readId) {
    peerLastReadMessageId = String(readId || '0');

    var items = byId('messages').getElementsByTagName('small');
    var i;

    for (i = 0; i < items.length; i++) {
      if (items[i].className === 'message-status') {
        var id = items[i].getAttribute('data-message-id');
        items[i].innerHTML = isIdAtOrBelow(id, peerLastReadMessageId)
          ? 'Đã xem' : 'Đã gửi';
      }
    }
  }

  function formatMessageDateTime(value) {
    if (!value) return '';

    var date = new Date(value);
    if (isNaN(date.getTime())) return '';

    function pad(number) {
      return number < 10 ? '0' + number : String(number);
    }

    return pad(date.getDate()) + '/' +
      pad(date.getMonth() + 1) + '/' +
      date.getFullYear() + ' ' +
      pad(date.getHours()) + ':' +
      pad(date.getMinutes());
  }

  function addMessage(message) {
    var container = byId('messages');
    var item = document.createElement('div');
    var sender = document.createElement('strong');
    var body = document.createElement('div');
    var type = message.type || 'text';

    item.className = 'message';

    sender.appendChild(document.createTextNode(
      String(message.senderId) === String(currentUser.id)
        ? 'Bạn'
        : currentConversationTitle
    ));

    if (type === 'image' && message.imageUrl) {
      var img = document.createElement('img');
      img.src = message.imageUrl;
      img.alt = 'Ảnh trong tin nhắn - bấm để xem đầy đủ';
      img.className = 'chat-image';

      var imageLink = document.createElement('a');
      imageLink.href = message.imageUrl;
      imageLink.target = '_blank';
      imageLink.title = 'Mở ảnh kích thước đầy đủ';
      imageLink.appendChild(img);
      body.appendChild(imageLink);
    } else if (type === 'sticker') {
      var stickerImg = document.createElement('img');
      stickerImg.className = 'chat-sticker-image';
      stickerImg.src = '/stickers/capoo/' +
        encodeURIComponent(message.stickerCode) + '.png';
      stickerImg.alt = 'Sticker mèo Capoo';
      stickerImg.width = 96;
      stickerImg.height = 96;
      body.appendChild(stickerImg);
    } else {
      body.appendChild(document.createTextNode(message.body || ''));
    }

    item.appendChild(sender);
    item.appendChild(body);

    var formattedTime = formatMessageDateTime(message.createdAt);
    if (formattedTime) {
      var timeLabel = document.createElement('small');
      timeLabel.className = 'message-time';
      timeLabel.appendChild(document.createTextNode(formattedTime));
      item.appendChild(timeLabel);
    }

    if (String(message.senderId) === String(currentUser.id)) {
      var messageStatus = document.createElement('small');
      messageStatus.className = 'message-status';
      messageStatus.setAttribute('data-message-id', String(message.id));
      messageStatus.appendChild(document.createTextNode(
        isIdAtOrBelow(String(message.id), peerLastReadMessageId)
          ? 'Đã xem' : 'Đã gửi'
      ));
      item.appendChild(messageStatus);
    }

    container.appendChild(item);

    lastMessageId = String(message.id);
    container.scrollTop = container.scrollHeight;
  }

  function markConversationRead(conversationId, lastId) {
    if (!lastId || String(lastId) === '0') return;

    request(
      'POST',
      '/api/conversations/' + encodeURIComponent(conversationId) + '/read',
      { lastMessageId: String(lastId) },
      function (err) {
        if (!err) {
          loadConversations();
        } else {
          notice(err.message, true);
        }
      }
    );
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
          updateMessageStatuses(result.peerLastReadMessageId || '0');

          var i;
          for (i = 0; i < result.messages.length; i++) {
            addMessage(result.messages[i]);
          }

          if (result.messages.length > 0) {
            markConversationRead(conversationId, lastMessageId);
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

  function loadProfile() {
    request('GET', '/api/profile/me', null, function (err, result) {
      if (err) {
        notice(err.message, true);
        return;
      }

      var user = result.user;
      byId('profileDisplayName').value = user.displayName || '';
      byId('profileBio').value = user.bio || '';
      renderAvatar(user.avatarUrl || '');
    });
  }

  function renderAvatar(url) {
    var preview = byId('avatarPreview');
    preview.innerHTML = '';

    if (!url) {
      preview.appendChild(document.createTextNode('Chưa có avatar.'));
      return;
    }

    var img = document.createElement('img');
    img.src = url;
    img.alt = 'Avatar của bạn - bấm để xem đầy đủ';
    img.className = 'avatar-preview-image';

    var avatarLink = document.createElement('a');
    avatarLink.href = url;
    avatarLink.target = '_blank';
    avatarLink.title = 'Mở ảnh đại diện kích thước đầy đủ';
    avatarLink.appendChild(img);
    preview.appendChild(avatarLink);
  }

  function uploadFile(url, file, callback) {
    var xhr = new XMLHttpRequest();
    var formData = new FormData();

    formData.append('image', file);

    xhr.open('POST', url, true);
    xhr.setRequestHeader('Accept', 'application/json');

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
        callback(new Error(result.error || ('Lỗi HTTP ' + xhr.status)));
        return;
      }

      callback(null, result);
    };

    xhr.onerror = function () {
      callback(new Error('Không thể tải ảnh lên.'));
    };

    xhr.send(formData);
  }

  byId('profileToggle').onclick = function () {
    var panel = byId('profilePanel');
    var opening = panel.style.display === 'none';
    panel.style.display = opening ? 'block' : 'none';

    if (opening) loadProfile();
  };

  byId('profileForm').onsubmit = function () {
    request('POST', '/api/profile', {
      displayName: byId('profileDisplayName').value,
      bio: byId('profileBio').value
    }, function (err, result) {
      if (err) {
        notice(err.message, true);
        return;
      }

      currentUser.displayName = result.user.displayName;
      notice('Đã lưu hồ sơ.');
    });

    return false;
  };

  byId('avatarForm').onsubmit = function () {
    var file = byId('avatarFile').files[0];

    if (!file) {
      notice('Hãy chọn ảnh đại diện trước.', true);
      return false;
    }

    if (file.size > 9 * 1024 * 1024) {
      notice('Ảnh tối đa 9 MiB.', true);
      return false;
    }

    uploadFile('/api/profile/avatar', file, function (err, result) {
      if (err) {
        notice(err.message, true);
        return;
      }

      renderAvatar(result.user.avatarUrl);
      byId('avatarFile').value = '';
      notice('Đã cập nhật avatar.');
    });

    return false;
  };

  function sendAttachment(data) {
    if (!currentConversationId) {
      notice('Hãy chọn một cuộc trò chuyện trước.', true);
      return;
    }

    request(
      'POST',
      '/api/conversations/' +
        encodeURIComponent(currentConversationId) + '/attachments',
      data,
      function (err, result) {
        if (err) {
          notice(err.message, true);
          return;
        }

        if (result.message) addMessage(result.message);
        notice('Đã gửi nội dung.');
      }
    );
  }

  byId('sendImageButton').onclick = function () {
    var file = byId('messageImageFile').files[0];

    if (!currentConversationId) {
      notice('Hãy chọn một cuộc trò chuyện trước.', true);
      return;
    }

    if (!file) {
      notice('Hãy chọn ảnh muốn gửi.', true);
      return;
    }

    if (file.size > 9 * 1024 * 1024) {
      notice('Ảnh tối đa 9 MiB.', true);
      return;
    }

    uploadFile('/api/uploads/image', file, function (err, result) {
      if (err) {
        notice(err.message, true);
        return;
      }

      sendAttachment({
        type: 'image',
        imageUrl: result.imageUrl
      });

      byId('messageImageFile').value = '';
    });
  };

  var stickerButtons = byId('stickerPicker').getElementsByTagName('button');
  var stickerIndex;

  for (stickerIndex = 0; stickerIndex < stickerButtons.length; stickerIndex++) {
    (function (button) {
      button.onclick = function () {
        sendAttachment({
          type: 'sticker',
          stickerCode: button.getAttribute('data-sticker')
        });
      };
    })(stickerButtons[stickerIndex]);
  }
  byId('soundToggle').onclick = function () {
    var audio = byId('notificationSound');

    if (!audio) {
      notice('Không tìm thấy âm báo.', true);
      return;
    }

    try {
      audio.currentTime = 0;
      var playback = audio.play();

      if (playback && typeof playback.then === 'function') {
        playback.then(function () {
          soundEnabled = true;
          notice('Đã bật âm báo.');
          byId('soundToggle').innerHTML = 'Âm báo đang bật';
        }, function () {
          soundEnabled = false;
          notice('Trình duyệt chưa cho phép phát âm thanh. Hãy thử nhấn lại.', true);
        });
      } else {
        soundEnabled = true;
        notice('Đã bật âm báo nếu trình duyệt hỗ trợ.');
        byId('soundToggle').innerHTML = 'Âm báo đang bật';
      }
    } catch (e) {
      soundEnabled = false;
      notice('Trình duyệt không hỗ trợ phát âm thanh này.', true);
    }
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







