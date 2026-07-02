const API = {
  async _post(action, body = {}) {
    const res = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...body }),
    });
    return this._parse(res);
  },

  async _parse(res) {
    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error("서버 응답을 읽지 못했습니다. 웹앱 URL/배포 상태를 확인해 주세요.");
    }
    if (!data || data.ok !== true) {
      throw new Error((data && data.error) || "요청에 실패했습니다.");
    }
    return data.data;
  },

  createReservation(payload) {
    return this._post("createReservation", payload);
  },
  getReservations(token, from, to) {
    return this._post("getReservations", { token, from, to });
  },
  setStatus(token, id, status) {
    return this._post("setStatus", { token, id, status });
  },
};
