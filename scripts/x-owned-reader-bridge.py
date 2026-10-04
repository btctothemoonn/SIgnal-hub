#!/usr/bin/env python3
"""One-session owned X reader. stdin v1 task; stdout sanitized v1 JSONL only."""
import asyncio
from contextlib import closing, contextmanager
import importlib.metadata
import importlib.util
import json
import math
import os
from pathlib import Path
import sqlite3
import sys
import time

os.environ['TWS_TELEMETRY']='0'
os.environ['TWS_LOG_LEVEL']='CRITICAL'
os.environ['TWS_HTTP_BACKEND']='httpx'
os.umask(0o077)
spec=importlib.util.spec_from_file_location('owned_reader_core',Path(__file__).with_name('x-owned-reader-bridge-core.py'))
core=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=core
spec.loader.exec_module(core)

def session_status(path):
    """Read aggregate readiness and lock timestamps, never cookie columns."""
    path=Path(path)
    if not path.is_file(): return {'sessionAvailable':False,'until':None}
    try:
        with closing(sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True)) as connection:
            count,active=connection.execute('SELECT count(*), sum(CASE WHEN active=1 THEN 1 ELSE 0 END) FROM accounts').fetchone()
            # Only endpoint locks used by this bridge can delay this read.
            rows=connection.execute("SELECT j.value FROM accounts, json_each(COALESCE(accounts.locks,'{}')) AS j WHERE j.key IN ('UserByScreenName','UserTweets','UserTweetsAndReplies','TweetDetail')").fetchall()
        until=0
        for (value,) in rows:
            try:
                stamp=core.instant(value if '+' in value or value.endswith('Z') else value+'+00:00')
                until=max(until,stamp)
            except (ValueError,TypeError,AttributeError): return {'sessionAvailable':False,'until':None}
        return {'sessionAvailable':count==1 and active==1,'until':until if until>time.time() else None}
    except (sqlite3.Error,OSError): return {'sessionAvailable':False,'until':None}

def sdk_version():
    try: return importlib.metadata.version('twscrape')
    except importlib.metadata.PackageNotFoundError: return None

@contextmanager
def sdk_guards(gate):
    """Install before creating clients, including SDK bootstrap clients."""
    import httpx
    from twscrape.http import HttpxClient
    from twscrape.queue_client import QueueClient
    from twscrape.xclid import XClIdAccountError, XClIdGen
    from loguru import logger
    logger.remove()
    original_transport=httpx.AsyncHTTPTransport
    original_request=HttpxClient.request
    original_init=HttpxClient.__init__
    original_close=QueueClient._close_ctx
    original_create=XClIdGen.create
    class NoRetryTransport(original_transport):
        def __init__(self,*args,**kwargs):
            kwargs['retries']=0; super().__init__(*args,**kwargs)
    def initialize(client,*args,**kwargs):
        original_init(client,*args,**kwargs)
        client._client.follow_redirects=False
    async def request(client,method,url,**kwargs):
        async def send(method,url,**kwargs): return await original_request(client,method,url,**kwargs)
        return await gate.request(send,method,url,**kwargs)
    async def close(client,reset_at=-1,inactive=False,msg=None):
        if gate.stopped and client.ctx is not None:
            if gate.stopped=='login_or_access_challenge': inactive=True; msg='Owned reader authentication check failed'
            elif gate.next_retry_at is not None: reset_at=max(reset_at,math.ceil(core.instant(gate.next_retry_at)))
            elif gate.stopped in ('request_budget_reached','cycle_deadline_reached'): reset_at=max(reset_at,int(time.time())+60)
        return await original_close(client,reset_at=reset_at,inactive=inactive,msg=msg)
    async def create(*args,**kwargs):
        try: return await original_create(*args,**kwargs)
        except XClIdAccountError: gate.stop('login_or_access_challenge')
    httpx.AsyncHTTPTransport=NoRetryTransport; HttpxClient.__init__=initialize; HttpxClient.request=request; QueueClient._close_ctx=close
    XClIdGen.create=staticmethod(create)
    try: yield
    finally:
        httpx.AsyncHTTPTransport=original_transport; HttpxClient.__init__=original_init; HttpxClient.request=original_request; QueueClient._close_ctx=original_close
        XClIdGen.create=staticmethod(original_create)

async def run(task,emit):
    status=session_status(task['sessionDbPath']); cooldown=core.cooldown_state(task['cooldownFilePath']); version=sdk_version()
    if task.get('mode')=='doctor':
        until=(cooldown or {}).get('until') or status['until']
        emit('doctor',sdkVersion=version,protocolVersion=1,sessionAvailable=status['sessionAvailable'],coolingDown=bool(cooldown or status['until']),nextRetryAt=core.RequestGate.to_iso(until))
        emit('cycle_complete',requests=0,completedAccounts=0,reason=None); return
    gate=core.RequestGate(task['cooldownFilePath'],max_requests=task['maxRequests'],deadline_ms=task['deadlineMs'],min_interval_ms=task['minIntervalMs'])
    completed=0
    try:
        if cooldown: raise core.ReaderStop(cooldown['reason'],core.RequestGate.to_iso(cooldown['until']))
        if not status['sessionAvailable']: raise core.ReaderStop('session_unavailable')
        if status['until']: raise core.ReaderStop('session_cooldown',core.RequestGate.to_iso(status['until']))
        if version!='0.20.1': raise core.ReaderStop('sdk_unavailable')
        from loguru import logger
        logger.remove()
        from twscrape import API
        import twscrape.api as api_module
        logger.remove()
        with sdk_guards(gate):
            api=API(task['sessionDbPath'],raise_when_no_account=True,wait_timeout=0,debug=False)
            async with asyncio.timeout(task['deadlineMs']/1000):
                async def resolve(requested):
                    account={**requested}
                    if not account.get('userId'):
                        response=await api.user_by_login_raw(account['username'])
                        body=response.json() if response else {}
                        profile=core.nested(body,'data','user','result')
                        if not isinstance(profile,dict): gate.stop('unexpected_api_response',time.time()+300)
                        user_id=str(profile.get('rest_id',''))
                        username=core.nested(profile,'core','screen_name') or core.nested(profile,'legacy','screen_name')
                        if not core.IDENTIFIER.fullmatch(user_id) or not isinstance(username,str) or username.lower()!=account['username'].lower(): gate.stop('unexpected_api_response',time.time()+300)
                        account['userId']=user_id
                        if core.nested(profile,'privacy','protected') is True or core.nested(profile,'legacy','protected') is True: account['_skip_reason']='protected_account'
                    return account
                async def fetch(account,kind,cursor):
                    variables={'userId':str(account['userId']),'count':40,'includePromotedContent':False,'withVoice':True,'withV2Timeline':True}
                    if kind=='posts': variables['withQuickPromoteEligibilityTweetFields']=True; operation=api_module.OP_UserTweets
                    else: variables['withCommunity']=True; operation=api_module.OP_UserTweetsAndReplies
                    if cursor is not None: variables['cursor']=cursor
                    response=await api._gql_item(operation,variables)
                    if response is None: gate.stop('unexpected_api_response',time.time()+300)
                    return response.json()
                async def detail(account,identifier):
                    response=await api.tweet_details_raw(int(identifier),kv={'includePromotedContent':False})
                    if response is None: gate.stop('unexpected_api_response',time.time()+300)
                    return response.json()
                def finish(result):
                    nonlocal completed
                    emit('account_complete',**{key:value for key,value in result.items() if key not in ('tweets','fromAt') and not key.startswith('_')})
                    completed+=int(result['complete'])
                await core.scan_cycle(task['accounts'],resolve,fetch,task['maxPages'],lambda event:emit('tweet',**event),finish,detail)
    except core.ReaderStop as stopped:
        if completed!=len(task['accounts']) or stopped.reason not in ('request_budget_reached','cycle_deadline_reached'):
            emit('paused',reason=stopped.reason,nextRetryAt=stopped.next_retry_at)
    except TimeoutError:
        try: gate.stop('cycle_deadline_reached',time.time()+60,persist=False)
        except core.ReaderStop as stopped:
            if completed!=len(task['accounts']): emit('paused',reason=stopped.reason,nextRetryAt=stopped.next_retry_at)
    except Exception:
        # No exception text/stack/headers can enter protocol or stderr.
        try: gate.stop('network_error_paused',time.time()+300)
        except core.ReaderStop as stopped: emit('paused',reason=stopped.reason,nextRetryAt=stopped.next_retry_at)
        emit('error',reason='library_or_network_error')
    finally: emit('cycle_complete',requests=gate.count,completedAccounts=completed,reason=gate.stopped)

def main():
    task={}; terminal=False
    def emit(kind,**fields):
        nonlocal terminal
        if kind=='cycle_complete': terminal=True
        print(json.dumps({'version':1,'runId':task.get('runId','invalid'),'type':kind,**fields},ensure_ascii=False,separators=(',',':')),flush=True)
    try:
        raw=sys.stdin.buffer.read(65537)
        if len(raw)>65536: raise ValueError('invalid_task')
        task=core.validate_task(json.loads(raw))
    except (ValueError,TypeError,KeyError):
        emit('error',reason='invalid_task'); emit('cycle_complete',requests=0,completedAccounts=0,reason='invalid_task'); return 0
    try: asyncio.run(run(task,emit))
    except Exception:
        emit('error',reason='library_or_network_error')
        if not terminal: emit('cycle_complete',requests=0,completedAccounts=0,reason='library_or_network_error')
    return 0

if __name__=='__main__': raise SystemExit(main())
