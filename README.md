# MyJSON - MySQL as JSON

This package provides an interface to a MySQL database, accessing data as JSON documents.

Queries are performed using JSON Schema to provide powerful search constraints on the data.

## Constructing a class

You generate a class using a config object.  This config file specifies:

* which table to use
* what data types to supply to / expect from different columns
* where in the resulting JSON document those values should go

```javascript
var myJson = require('my-json');

var TestClass = myJson({
	table: 'TestTable',
    keyColumn: 'integer/id',
	columns: {
		'integer/id': 'id',
		'string/name': 'name',
        'json': 'json_remainder'
	}
});
```

This will work with a table structure like:

```
+----------+----------+----------------+
|    id    |   name   | json_remainder |
+----------+----------+----------------+
|    5     |   blah   | {"extra": 20}  |
+----------+----------+----------------+
```

Columns of the `json` type contain a JSON representation of any properties that are *not* accounted-for by any of the other columns.  This table row therefore corresponds to a document like:

```json
{
    "id": 5,
    "name": "blah",
    "extra": 20
}
```

Currently it only supports plain objects (taken from a single row), but support for arrays (as table joins) is planned - see the PHP equivalent [JSON Store](https://github.com/geraintluff/json-store) for what's planned.

## Binding to a MySQL connection

For all the operations, you can either supply a MySQL connection each time, or you can bind a connection.  Binding also creates a cache - these bindings are therefore expected to be temporary (perhaps once per request for a web-server).

```javascript
var mysql = require('mysql');
var connection = mysql.createConnection({...});

var BoundTestClass = TestClass.cacheWith(connection);
```

## Loading, saving, editing

### Open (via JSON Schema search):

```javascript
TestClass.search(connection, schema, function (err, results) {...});
BoundTestClass.search(schema, function (err, results) {...});
```

Currently, the only schema keywords supported are `properties` and `enum`, but support for all validation keywords is planned.

### Save:

```javascript
TestClass.save(connection, testObj, function (err, results) {...});
BoundTestClass.save(testObj, function (err, results) {...});
```

### Create:

Creation is performed by saving an object that is missing a key column:

```javascript
var newObj = new TestClass();
newObj.name = 'test';

TestClass.save(connection, testObj, function (err, results) {...});
// or:
BoundTestClass.save(testObj, function (err, results) {...});

newObj.id; // populated using the auto-increment, if there is one
```

### Remove/delete:

```javascript
TestClass.remove(connection, testObj, function (err, results) {...});
BoundTestClass.remove(testObj, function (err, results) {...});
```