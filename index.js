const express = require('express');
const app = express();
const http = require('http').Server(app);
const moment = require('moment');
const crypto = require('crypto');

var path = require('path');
var bodyParser = require('body-parser');
var session = require('express-session')
var cookieParser = require('cookie-parser');
var useragent = require('express-useragent');

/*var WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 11111 });*/

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(useragent.express());
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.use(session({
    secret: 'bDfe@44!aKim',
    resave: true,
    saveUninitialized: true
}));


const CosmosClient = require('@azure/cosmos').CosmosClient;
const config = require('./config');
const url = require('url');

const endpoint = config.endpoint;
const key = config.key;

const databaseId = config.database.id;
const partitionKey = { kind: 'Hash', paths: ['/P0'] };

const dbClient = new CosmosClient({ endpoint, key });
const database = dbClient.database(databaseId);

var updateTimeout = 1000; //msec
var enemyPlrDT = 5*60; //5 * 60; //5minutes
var inActivePlrDT = 5; //5 sec

var playerMap = new Map();

app.use(bodyParser.urlencoded({extended: true}));
app.use(express.json());

app.get('/',(req,res) => {
    
    var pageData = {
        title: "SAF-ATM",
    };

    var uid = req.session.userId;

    if(uid === undefined || uid == null)
    {
        pageData.logged = false;
        pageData.uid = null;
    } else {
        pageData.logged = true;
        pageData.uid = uid;
        pageData.playerMap = playerMap;
    }
    res.render("pages/home", {data: pageData});
});

app.get('/profile', (req,res) => {
    var uid = req.session.userId;
    var pageData = {
        title: ""
    };
    if(uid !== undefined || uid != null)
    {
        pageData.title = "SAS-ATM Profil"
        pageData.logged = true;
        pageData.uid = uid;
    }
    else {
        pageData.title = "SAF-ATM Přihlášení / registrace";
        pageData.logged = false; 
        pageData.uid = null;       
    }
    res.render("pages/profile", {data: pageData});
});

app.get('/logout', (req,res) => {
    req.session.userId = null;
    res.redirect("/");
});

var mobAppVer = "1.0.2";
app.post('/getMobAppVer', (req,res) => {
    var verRes = {
        MobAppVersion: mobAppVer,
    };
    res.send(verRes);
});

/*wss.on('connection', (ws) => {

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', (message) => {
        var dataObj = JSON.parse(message);
        parseCmdData(dataObj, ws);        
    });
});*/

app.post('/login', (req,res) => {
    var data = req.body;
    
    userAuth(data.login, pwdHash(data.pwd)).then((ret) => {
        
        if(ret.length == 1)
        {
            if(data.mob)
            {
                res.send({ id: ret[0].id, name: data.login, logged: true });
            } else {
                req.session.userId = ret[0].id;
                res.redirect('/');
            }
        } else {      
            if(data.mob)
            {
                res.send({ logged: false });
            } else {
                    var pageData = {
                    title: "Login",
                    error: "Bad credentials!"
                };
                res.render("pages/login", {data: pageData});
            }
        }
    });
});

app.post('/register', (req,res) => {
    var data = req.body;

    var userData = {
        login: data.login,
        hash: pwdHash(data.pwd),
        created: moment()
    };
    
    checkUserExist(data.login).then((exist) => {
        if(exist)
        {
            if(data.mob)
            {
                res.send({ logged: false });
            } else {
                var pageData = {
                    title: "Title",
                    msg: "Email '"+data.login+"' is in use."
                };
                res.render("pages/register", {data: pageData});
            }
        } else {
            createItem("Users", userData).then((ret) => {
                if(data.mob)
                {
                    res.send({ id: ret[0].id, name: data.login, logged: true });
                } else {
                    var pageData = {
                        title: "Title",
                        msg: "Registration complete!"
                    };
                    res.render("pages/register", {data: pageData});
                }
            });
        }
    });    
});

app.post('/post', (req,res) => {
    var data = req.body;
    var strRes = parseCmdData(data, false);
    console.log("Parsed: ",data);
    console.log("Sended:",strRes);
    res.send(strRes);
});

const port = process.env.PORT || 1337;
http.listen(port, () => {
    console.log("Server running at http://localhost:%d", port);
    setInterval(playerRemCheck, updateTimeout);
});

function parseCmdData(data, ws) {
    var jstr = "";
    if(data.cmd == "curPos" || data.cmd == "newEnemy" || data.cmd == "enemyMove" || data.cmd == "point")
    {
        var resObj = {
            id: "",
            name: "",
            lon: "0.00000000",
            lat: "0.00000000",
            dt: "",
            isEnemy: false,
            isPoint: false,
            userId: null
        };

        resObj.id = data.id;
        resObj.name = data.name;
        resObj.lon = String(data.lon);
        resObj.lat = String(data.lat);
        resObj.dt = moment(data.dt);

        if(data.cmd == "curPos")
        {
            resObj.userId = null;
            resObj.isEnemy = false;
            resObj.isPoint = false;
        }

        if(data.cmd == "newEnemy" || data.cmd == "enemyMove")
        {
            resObj.userId = data.userId;
            resObj.isEnemy = true;
            resObj.isPoint = false;
        }

        if(data.cmd == "point")
        {
            resObj.userId = data.userId;
            resObj.isEnemy = false;
            resObj.isPoint = true;
        }

        playerMap.set(resObj.id, resObj);
        jstr = mapToJson(playerMap);
    }
    
    if(jstr.length > 0 && ws != false)
        ws.send(jstr);
    else {
        return jstr;
    }
}

function mapToJson(map) {
    return JSON.stringify([...map]);
}

function objToJson(obj) {
    return JSON.stringify(obj);
}

function playerRemCheck() {
    var now = moment();
    playerMap.forEach(function(item, key, mapObj)
    {
        var itemDt = item.dt;
        var timeDifference = now.diff(itemDt, 'seconds');

        var difference = inActivePlrDT;
        if(!item.isPoint)
        {
            if(item.isEnemy)
                difference = enemyPlrDT

            if(timeDifference > difference)
            {
                playerMap.delete(key);
            }
        } else {
            if(timeDifference > (30*60))
            {
                playerMap.delete(key);
            }
        }
    });
}


async function queryTable(cntId)
{
    const container = database.container(cntId);
    const querySpec = {
      query: "SELECT * FROM c"
    };
    const { resources: results } = await container.items.query(querySpec).fetchAll();
    return results;
}

 async function createItem(cntId, newItem)
{
    const container = database.container(cntId);
    const { resource: createdItem } = await container.items.create(newItem);
    return createdItem;
}

async function getItem(cntId, id)
{
    const container = database.container(cntId);
    const { resource: item } = await container.item(id, "");
    return item;
}

async function updateItem(cntId, id, item)
{
    const container = database.container(cntId);
    const { resource: updatedItem } = await container.item(id, "").replace(item);
    return updatedItem;
}

async function removeItem(cntId, id)
{
    const container = database.container(cntId);
    const { resource: result } = await container.item(id, "").delete();
    return result;
}

function pwdHash(pwd)
{
    var hashSaltKey = "yQj69d@wI05uw";
    return crypto.createHmac('sha256', hashSaltKey).update(pwd).digest('hex');
}

async function userAuth(email, pwd)
{
    const container = database.container("Users");
    const queryUserPwd = {
      "query": "SELECT * FROM c WHERE c.login = '" + email + "' AND c.hash = '" + pwd + "'"
    };
    const { resources: results } = await container.items.query(queryUserPwd).fetchAll();
    
    return results;
}

async function checkUserExist(email)
{
    const container = database.container("Users");
    const queryUserPwd = {
      "query": "SELECT * FROM c WHERE c.login = '" + email + "'"
    };
    const { resources: results } = await container.items.query(queryUserPwd).fetchAll();
    
    return results.length > 0 ? true: false;
}