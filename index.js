const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
require("dotenv").config();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const app = express();
const morgan = require("morgan");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;


//!middleware
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

const verifyJwt = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }

  // bearer token
  const token = authorization.split(" ")[1];

  jwt.verify(token, process.env.SECRET_TOKEN, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .send({ error: true, message: "unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ccknyay.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    const usersCollection = client.db("summerCampDB").collection("users");
    const classesCollection = client.db("summerCampDB").collection("classes");
    const classCardsCollection = client
      .db("summerCampDB")
      .collection("classCards");
    const paymentsCollection = client.db("summerCampDB").collection("payments");

    //! Admin verify
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "admin") {
        return res
          .status(403)
          .send({ error: true, message: "forbidden message" });
      }
      next();
    };

    app.post("/jwt", (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.SECRET_TOKEN, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

      //!payment releted api
      app.get("/myPaymentClass", verifyJwt, async (req, res) => {
        const email = req.query.email;
        if (!email) {
          res.send([]);
        }
        const decodedEmail = req.decoded.email;
        if (email !== decodedEmail) {
          return res
            .status(403)
            .send({ error: true, message: "forbidden access" });
        }
        const query = { email: email };
        const result = await paymentsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.send(result);
      });
  
      app.post("/payments", verifyJwt, async (req, res) => {
        const payment = req.body;
        payment.createdAt = new Date();
        const filter = { _id: new ObjectId(payment.menuItems) };
        const updateDoc = {
          $inc: { seats: -1, enrolled: 1 },
        };
        const insertResult = await paymentsCollection.insertOne(payment);
        const deleteResult = await classCardsCollection.deleteOne({
          _id: new ObjectId(payment.cartItems),
        });
        const updated = await classesCollection.updateOne(filter, updateDoc);
  
        res.send({ insertResult, deleteResult, updated });
      });
  
      app.post("/create-payment-intent", verifyJwt, async (req, res) => {
        const { price } = req.body;
        const amount = parseInt(price * 100);
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "INR",
          payment_method_types: ["card"],
        });
        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      });
      //!ClassCard reletead api
      app.get("/myAddedClass", verifyJwt, async (req, res) => {
        const email = req.query.email;
        if (!email) {
          res.send([]);
        }
        const decodedEmail = req.decoded.email;
        if (email !== decodedEmail) {
          return res
            .status(403)
            .send({ error: true, message: "forbidden access" });
        }
        const query = { email: email };
        const result = await classCardsCollection.find(query).toArray();
        res.send(result);
      });
      app.get("/singleClass/:id", async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await classCardsCollection.findOne(query);
        res.send(result);
      });
  
      app.post("/addToClass", async (req, res) => {
        const addClass = req.body;
        const query = { selectedClassId: addClass.selectedClassId };
        const existingUser = await classCardsCollection.findOne(query);
        if (existingUser) {
          return res.send({ message: "This class already exists" });
        }
        const result = await classCardsCollection.insertOne(addClass);
        res.send(result);
      });
      app.delete("/deleteToClass/:id",verifyJwt, async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await classCardsCollection.deleteOne(query);
        res.send(result);
      });

       //!Class repleted api
    app.get("/allClasses", async (req, res) => {
      const allClasses = await classesCollection.find().sort({enrolled: -1}).toArray();
      res.send(allClasses);
    });
    app.get("/myClass/:email",verifyJwt, async (req, res) => {
      const email = req.params.email;
      const query = { InstructorEmail: email };
      const result = await classesCollection.find(query).toArray();
      res.send(result);
    });
    app.get("/approvedClass",  async (req, res) => {
      const query = { status: "approved" };
      const result = await classesCollection.find(query).toArray();
      res.send(result);
    });
    app.get("/feedback/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await classesCollection.findOne(query);
      res.send(result);
    });
    app.put("/feedback/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const classFeedback = req.body;
      const myFeedback = {
        $set: {
          feedback: classFeedback.feedback,
        },
      };
      const result = await classesCollection.updateOne(
        filter,
        myFeedback,
        options
      );
      res.send(result);
    });
    app.post("/addedClass", async (req, res) => {
      const classes = req.body;
      const result = await classesCollection.insertOne(classes);
      res.send(result);
    });
    app.patch("/approved/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status: "approved",
        },
      };
      const result = await classesCollection.updateOne(filter, updateDoc);
      res.send(result);
    });
    app.patch("/denied/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status: "denied",
        },
      };
      const result = await classesCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

     //!User relented api
     app.get("/users", verifyJwt, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });
    app.get("/instructors", async (req, res) => {
      const query = { role: "instructors" };
      const result = await usersCollection.find(query).toArray()
      res.send(result)
    });
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });
    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });
    app.get("/users/admin/:email", verifyJwt, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.send({ admin: false });
      }

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const result = { admin: user?.role === "admin" };
      res.send(result);
    });
    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });
    app.patch("/users/instructors/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: "instructors",
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });
    app.get("/users/instructors/:email", verifyJwt, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.send({ instructors: false });
      }

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const result = { instructors: user?.role === "instructors" };
      res.send(result);
    });

     // Send a ping to confirm a successful connection
     await client.db("admin").command({ ping: 1 });
     console.log(
       "Pinged your deployment. You successfully connected to MongoDB!"
     );
   } finally {
     // Ensures that the client will close when you finish/error
     // await client.close();
   }
 }
   
 run().catch(console.dir);
 
 app.get("/", (req, res) => {
   res.send("Summer Camp Server is running........");
 });
 
 app.listen(port, () => {
   console.log(`Summer Camp server is running on: ${port}`);
 });
 