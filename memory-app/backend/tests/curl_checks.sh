#!/usr/bin/env bash
# Proves header-only identity, per-user isolation, undo on append, diary rules
# and trash behaviour against a running backend. Run from Git Bash:
#   PY=.venv/Scripts/python.exe bash memory-app/backend/tests/curl_checks.sh
# Creates two throwaway users and permanently deletes their notes at the end.
API=${API:-http://localhost:8000}
PY=${PY:-python}
uuid() { $PY -c "import uuid, sys; sys.stdout.reconfigure(newline='\n'); print(uuid.uuid4())"; }
A=$(uuid); B=$(uuid)
TODAY=$(date +%Y-%m-%d)
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  PASS  $1"; else fail=$((fail+1)); echo "  FAIL  $1 (expected $3, got $2)"; fi; }
# api USER METHOD PATH [JSON]  -> sets BODY and CODE
api() { local out; out=$(curl -s -w $'\n%{http_code}' -X "$2" "$API$3" -H "X-User-Id: $1" -H "X-Client-Date: $TODAY" \
        -H "Content-Type: application/json" ${4:+-d "$4"}); CODE=${out##*$'\n'}; BODY=${out%$'\n'*}; }
# field EXPR -> evaluates EXPR against the last response (d). Windows Python would
# print \r\n line endings, so stdout is switched to plain \n.
field() { echo "$BODY" | $PY -c "import sys, json; sys.stdout.reconfigure(newline='\n'); d = json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
echo "User A: $A"; echo "User B: $B"

echo; echo "== 1. user_id travels only in the X-User-Id header"
check "no header -> 422"             "$(curl -s -o /dev/null -w '%{http_code}' $API/notes)" 422
check "malformed header -> 422"      "$(curl -s -o /dev/null -w '%{http_code}' -H 'X-User-Id: default_user' $API/notes)" 422
check "?user_id= query only -> 422"  "$(curl -s -o /dev/null -w '%{http_code}' "$API/notes?user_id=$A")" 422

echo; echo "== 2. Seed: both users own a list called Groceries"
api "$A" POST /notes '{"type":"list","title":"Groceries","body":"milk\nbread"}';        A_LIST=$(field "d['note']['id']")
api "$A" POST /notes '{"type":"text","title":"Bike repair","body":"Rear brake pads are worn and need replacing."}'; A_TEXT=$(field "d['note']['id']")
api "$B" POST /notes '{"type":"list","title":"Groceries","body":"cello strings\nrosin"}'; B_LIST=$(field "d['note']['id']")
api "$A" GET /notes/$A_LIST; check "A's list stored as checklist lines" "$(field "d['note']['body']")" $'- [ ] milk\n- [ ] bread'

echo; echo "== 3. Isolation: B can never see or touch A's notes"
api "$A" GET /notes; check "A lists 2 notes" "$(field "len(d['notes'])")" 2
api "$B" GET /notes; check "B lists 1 note"  "$(field "len(d['notes'])")" 1
check "B's list does not contain A's ids" "$(field "any(n['id'] in ('$A_LIST','$A_TEXT') for n in d['notes'])")" False
api "$B" GET /notes/$A_LIST;                     check "B GET A's note -> 404"     "$CODE" 404
api "$B" POST /notes/search '{"query":"brake pads bike repair"}'
check "B searching A's exact words finds none of A's notes" "$(field "[n['title'] for n in d['notes']]")" "['Groceries']"
check "  ...and that Groceries is B's own" "$(field "d['notes'][0]['id']")" "$B_LIST"
api "$B" PUT /notes/$A_LIST '{"body":"hacked"}'; check "B PUT A's note -> 404"     "$CODE" 404
api "$B" POST /notes/$A_LIST/append '{"text":"x"}'; check "B append to A's -> 404" "$CODE" 404
api "$B" POST /notes/$A_LIST/undo;               check "B undo A's note -> 404"    "$CODE" 404
api "$B" DELETE /notes/$A_LIST;                  check "B delete A's note -> 404"  "$CODE" 404
api "$A" GET /notes/$A_LIST;                     check "A's note untouched after B's attempts" "$(field "d['note']['body']")" $'- [ ] milk\n- [ ] bread'

echo; echo "== 4. Undo covers append"
api "$A" POST /notes/$A_LIST/append '{"text":"eggs"}'
check "append adds a checklist line"  "$(field "d['note']['body']")" $'- [ ] milk\n- [ ] bread\n- [ ] eggs'
check "append made undo available"   "$(field "d['note']['has_undo']")" True
api "$A" POST /notes/$A_LIST/undo;   check "undo removes the appended line" "$(field "d['note']['body']")" $'- [ ] milk\n- [ ] bread'
api "$A" POST /notes/$A_LIST/undo;   check "undo again redoes it"           "$(field "d['note']['body']")" $'- [ ] milk\n- [ ] bread\n- [ ] eggs'
api "$A" PUT /notes/$A_LIST '{"body":"- [x] milk\n- [ ] bread\n- [ ] eggs"}'
api "$A" POST /notes/$A_LIST/undo;   check "ticking a box is undoable too"  "$(field "d['note']['body']")" $'- [ ] milk\n- [ ] bread\n- [ ] eggs'

echo; echo "== 5. Diary: one entry per day, titled with the date"
api "$A" POST /notes '{"type":"diary","title":"ignored","body":"Morning run."}'; DIARY=$(field "d['note']['id']")
EXPECTED_TITLE=$($PY -c "import datetime as t, sys; sys.stdout.reconfigure(newline='\n'); d = t.date.fromisoformat('$TODAY'); print(f'{d:%A} {d.day} {d:%B %Y}')")
check "diary title is the date" "$(field "d['note']['title']")" "$EXPECTED_TITLE"
api "$A" POST /notes '{"type":"diary","body":"Evening: fixed the brakes."}'
check "second diary create appends to today's entry" "$(field "d['appended_to_existing']") $(field "d['note']['id']")" "True $DIARY"

echo; echo "== 6. Conflict: saving over a newer version is refused"
api "$A" PUT /notes/$A_TEXT '{"body":"new text","expected_updated":"2000-01-01T00:00:00+00:00"}'
check "stale expected_updated -> 409" "$CODE" 409

echo; echo "== 7. Soft delete, trash isolation, restore, purge"
api "$A" DELETE /notes/$A_TEXT;  check "A soft-deletes Bike repair" "$(field "d['note']['deleted']")" True
api "$A" GET /notes;             check "gone from A's notes view"   "$(field "'$A_TEXT' in [n['id'] for n in d['notes']]")" False
api "$A" POST /notes/search '{"query":"brake pads"}'; check "gone from A's search" "$(field "'$A_TEXT' in [n['id'] for n in d['notes']]")" False
api "$A" GET /trash;             check "in A's trash"               "$(field "[n['id'] for n in d['notes']]")" "['$A_TEXT']"
api "$B" GET /trash;             check "B's trash is empty"         "$(field "len(d['notes'])")" 0
api "$B" POST /trash/$A_TEXT/restore; check "B restore A's note -> 404" "$CODE" 404
api "$B" DELETE /trash/$A_TEXT;       check "B purge A's note -> 404"   "$CODE" 404
api "$A" POST /trash/$A_TEXT/restore; check "A restores it"            "$(field "d['note']['deleted']")" False
api "$A" DELETE /trash/$A_TEXT;       check "purge refuses a note not in the trash -> 400" "$CODE" 400
api "$A" DELETE /notes/$A_TEXT; api "$A" DELETE /trash/$A_TEXT; check "A purges it from the trash" "$CODE" 200
api "$A" GET /notes/$A_TEXT;          check "purged note is gone for good -> 404" "$CODE" 404

echo; echo "== Cleanup: permanently delete both users' notes"
for U in "$A" "$B"; do
  api "$U" GET /notes
  for id in $(field "' '.join(n['id'] for n in d['notes'])"); do
    curl -s -o /dev/null -X DELETE "$API/notes/$id" -H "X-User-Id: $U"
    curl -s -o /dev/null -X DELETE "$API/trash/$id" -H "X-User-Id: $U"
  done
  api "$U" GET /notes; echo "  $([ "$U" = "$A" ] && echo A || echo B) notes left: $(field "len(d['notes'])")"
done
echo; echo "RESULT: $pass passed, $fail failed"
