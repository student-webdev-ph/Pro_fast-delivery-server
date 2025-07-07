const dotenv = require('dotenv')
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");
const app = express();
const port = process.env.PORT || 3000;

dotenv.config();

const stripe = require('stripe')(process.env.PAYMENT_KEY);

//middleware
app.use(cors());
app.use(express.json());



const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decodedKey)

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ccnzwu7.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        const parcelCollection = client.db('parcelDB').collection('parcel')
        const paymentCollection = client.db('parcelDB').collection('payments')
        const userCollection = client.db('parcelDB').collection('users')
        const ridersCollection = client.db('parcelDB').collection('riders')
        const trackingCollection = client.db('parcelDB').collection('tracking')


        // custom middlewares
        const verifyFBToken = async (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).send({ message: 'unauthorized access' })
            }
            const token = authHeader.split(' ')[1];
            if (!token) {
                return res.status(401).send({ message: 'unauthorized access' })
            }

            //verify the token
            try {
                const decoded = await admin.auth().verifyIdToken(token)
                req.decoded = decoded
                next();
            }
            catch (error) {
                return res.status(403).send({ message: 'forbidden access' })
            }
        }

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email }
            const user = await userCollection.findOne(query);
            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'Forbidden access' })
            }
            next()
        }
        const verifyRider = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email }
            const user = await userCollection.findOne(query);
            if (!user || user.role !== 'rider') {
                return res.status(403).send({ message: 'Forbidden access' })
            }
            next()
        }


        app.post('/users', async (req, res) => {
            const email = req.body.email;
            const userExists = await userCollection.findOne({ email })
            if (userExists) {
                return res.status(200).send({ message: 'User already exists', inserted: false });
            }
            const user = req.body;
            const result = await userCollection.insertOne(user);
            res.send(result);
        })



        // GET /parcels?email=user@example.com
        app.get('/parcels', async (req, res) => {
            try {
                const { payment_status, delivery_status, email } = req.query;

                let query = {}
                if (payment_status) {
                    query.payment_status = payment_status;
                }

                if (delivery_status) {
                    query.delivery_status = delivery_status;
                }

                if (email) {
                    query.email = email;
                }
                const options = {
                    sort: { creation_date: -1 } // Sort by latest first
                }
                console.log(query)
                const parcels = await parcelCollection.find(query, options).toArray();

                res.send(parcels);
            } catch (error) {
                console.error("Error fetching parcels:", error);
                res.status(500).send({ error: "Internal Server Error" });
            }
        });








        app.get('/parcels/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await parcelCollection.findOne(query);
            if (!result) {
                return res.status(400).send({ message: 'Parcel not found' })
            }
            res.send(result)
        })


        app.post('/parcels', async (req, res) => {
            const parcels = req.body;
            const result = await parcelCollection.insertOne(parcels);
            res.send(result);
        })

        app.delete('/parcels/:id', async (req, res) => {
            const { id } = req.params;

            try {
                const result = await parcelCollection.deleteOne({ _id: new ObjectId(id) });
                res.send(result)

                // if (result.deletedCount === 1) {
                //     res.status(200).json({ message: 'Parcel deleted successfully' });
                // } else {
                //     res.status(404).json({ error: 'Parcel not found' });
                // }
            } catch (error) {
                console.error('Delete failed:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });



        //Tracking API
        app.post('/tracking', async (req, res) => {
            try {
                const { trackingId, status, description } = req.body;
                if (!trackingId || !status) {
                    return res.status(400).send({ message: 'Missing trackingId or status' });
                }

                const entry = {
                    trackingId,
                    status,
                    description: description || '',
                    timestamp: new Date(),
                };

                const result = await trackingCollection.insertOne(entry);
                res.send({ message: 'Tracking log saved', result });
            } catch (err) {
                console.error('Tracking POST error:', err);
                res.status(500).send({ message: 'Failed to save tracking' });
            }
        });
        // app.post('/tracking', async (req, res) => {
        //     try {
        //         const { trackingId, parcelId, status, location, message, updated_by = '' } = req.body;

        //         const result = await trackingCollection.insertOne({
        //             trackingId,
        //             parcelId: parcelId ? new ObjectId(parcelId) : undefined,
        //             status,
        //             location,
        //             message,
        //             updated_by,
        //             timestamp: new Date()
        //         });

        //         res.send(result);
        //     } catch (error) {
        //         console.error("Failed to insert tracking update:", error);
        //         res.status(500).send({ error: "Internal server error" });
        //     }
        // });

        app.get('/tracking/:trackingId', async (req, res) => {
            const { trackingId } = req.params;

            try {
                const logs = await trackingCollection
                    .find({ trackingId })
                    .sort({ timestamp: 1 }) // Oldest to newest
                    .toArray();

                res.send(logs);
            } catch (err) {
                console.error('Tracking GET error:', err);
                res.status(500).send({ message: 'Failed to get tracking history' });
            }
        });
        // app.get('/tracking/:trackingId', async (req, res) => {
        //     try {
        //         const trackingId = req.params.trackingId;

        //         const updates = await trackingCollection
        //             .find({ trackingId })
        //             .sort({ timestamp: -1 }) // newest first
        //             .toArray();

        //         res.send(updates);
        //     } catch (error) {
        //         console.error("Failed to fetch tracking updates:", error);
        //         res.status(500).send({ error: "Internal server error" });
        //     }
        // });





        //Payment API
        app.post('/create-payment-intent', async (req, res) => {
            const amountInCents = req.body.amountInCents
            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amountInCents, // Amount in cents
                    currency: 'usd',
                    payment_method_types: ['card'],
                });
                res.json({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });


        app.post('/payments', async (req, res) => {
            const { parcelId, email, amount, paymentMethod, transactionId } = req.body;

            try {
                // 1. Update the parcel's payment_status to "paid"
                const parcelResult = await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            payment_status: "paid",
                            payment_date: new Date(),
                            transaction_id: transactionId
                        }
                    }
                );
                if (parcelResult.modifiedCount === 0) {
                    return res.status(404).send({ message: 'parcel not found or already paid' })
                }


                // 2. Save payment history
                const paymentEntry = {
                    parcelId,
                    email,
                    amount,
                    paymentMethod,
                    transactionId,
                    payment_date_string: new Date().toISOString(),
                    payment_date: new Date()
                };

                const paymentResult = await paymentCollection.insertOne(paymentEntry);

                res.status(200).json({
                    message: "Payment processed successfully",
                    updated: parcelResult.modifiedCount > 0,
                    insertedId: paymentResult.insertedId
                });

            } catch (error) {
                console.error("Payment processing failed:", error);
                res.status(500).json({ error: "Internal Server Error" });
            }
        });


        //Get all payment history (admin)
        app.get('/payments', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const userEmail = req.query.email;
                console.log('decoded', req.decoded)
                if (req.decoded.email !== userEmail) {
                    return res.status(403).send({ message: 'unauthorized access' })
                }


                const query = userEmail ? { email: userEmail } : {}
                const options = { sort: { payment_date: -1 } } // Descending
                const payments = await paymentCollection
                    .find(query, options).toArray();

                res.send(payments);
            } catch (error) {
                console.error("Failed to get all payments:", error);
                res.status(500).json({ error: "Internal Server Error" });
            }
        });


        //POST rider INFO
        app.post('/riders', async (req, res) => {
            const rider = req.body;
            const result = await ridersCollection.insertOne(rider);
            res.send(result)
        })

        // Load pending rider applications
        app.get('/riders/pending', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const pendingRiders = await ridersCollection.find({ status: 'pending' }).toArray();
                res.send(pendingRiders);
            } catch (error) {
                console.error('❌ Error loading pending riders:', error.message);
                res.status(500).send({ error: 'Failed to load pending riders' });
            }
        });




        app.patch('/riders/:id/status', async (req, res) => {
            const id = req.params.id;
            const { status, email } = req.body;

            try {
                const filter = { _id: new ObjectId(id) };
                const update = { $set: { status } };

                const result = await ridersCollection.updateOne(filter, update);

                if (status === 'approved') {
                    const userQuery = { email };
                    const userUpdateDoc = {
                        $set: {
                            role: 'rider'
                        }
                    }
                    const roleResult = await userCollection.updateOne(userQuery, userUpdateDoc)
                    res.send(roleResult)
                }
                res.send(result);
            } catch (error) {
                console.error("❌ Failed to update status:", error.message);
                res.status(500).send({ error: "Failed to update rider status" });
            }
        });

        // GET /riders/approved
        app.get('/riders/approved', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const approved = await ridersCollection.find({ status: 'approved' }).toArray();
                res.send(approved);
            } catch (err) {
                res.status(500).send({ error: 'Failed to load approved riders' });
            }
        });

        //assign for deliver
        app.get('/riders/available', async (req, res) => {
            const { district } = req.query;

            if (!district) {
                return res.status(400).send({ message: 'District is required' });
            }

            try {
                const riders = await ridersCollection
                    .find({ district, status: 'approved' })
                    .toArray();

                res.send(riders);
            } catch (error) {
                console.error("❌ Error loading available riders:", error);
                res.status(500).send({ message: 'Failed to fetch riders' });
            }
        });
        app.patch('/parcels/:id/assign', async (req, res) => {
            const { id } = req.params;
            const { riderId } = req.body;

            if (!riderId) return res.status(400).send({ message: 'Missing rider ID' });

            try {

                const rider = await ridersCollection.findOne({ _id: new ObjectId(riderId) });
                if (!rider) return res.status(404).send({ message: 'Rider not found' });


                const parcelUpdate = await parcelCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            assignedRider: riderId,
                            assignedRiderEmail: rider.email,
                            delivery_status: 'assigned',
                            assignedAt: new Date()
                        }
                    }
                );

                const riderUpdate = await ridersCollection.updateOne(
                    { _id: new ObjectId(riderId) },
                    {
                        $set: {
                            work_status: 'in-delivery'
                        }
                    }
                );

                res.send({
                    message: 'Parcel and rider updated successfully',
                    parcelUpdate,
                    riderUpdate
                });

            } catch (error) {
                console.error('Assignment error:', error);
                res.status(500).send({ message: 'Failed to assign rider' });
            }
        });


        //All Pending parcels..........

        app.get('/rider/parcels', verifyFBToken, verifyRider, async (req, res) => {
            const { email } = req.query;

            if (!email) {
                return res.status(400).send({ message: "Missing rider email" });
            }

            try {
                const parcels = await parcelCollection.find({
                    assignedRiderEmail: email,
                    delivery_status: { $in: ['assigned', 'in-transit'] }
                }).toArray();

                res.send(parcels);
            } catch (error) {
                console.error('Error fetching rider parcels:', error);
                res.status(500).send({ message: "Failed to fetch rider's assigned parcels" });
            }
        });

        app.patch('/parcels/:id/status', async (req, res) => {
            const { id } = req.params;
            const { status, riderEmail } = req.body;

            if (!['in-transit', 'delivered'].includes(status)) {
                return res.status(400).send({ message: 'Invalid status' });
            }

            try {
                const parcelUpdate = await parcelCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            delivery_status: status,
                            [`${status}_At`]: new Date()
                        }
                    }
                );

                let riderUpdate = null;
                if (status === 'delivered' && riderEmail) {
                    riderUpdate = await ridersCollection.updateOne(
                        { email: riderEmail },
                        {
                            $unset: { work_status: "" } // removes the field
                        }
                    );
                }

                res.send({ parcelUpdate, riderUpdate });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: 'Failed to update delivery status' });
            }
        });

        //GET: Load completed parcel deliveries for a rider
        app.get('/rider/completed-parcels', verifyFBToken, verifyRider, async (req, res) => {
            const { email } = req.query;

            if (!email) {
                return res.status(400).send({ message: "Missing rider email" });
            }

            try {
                const completedParcels = await parcelCollection.find({
                    assignedRiderEmail: email,
                    delivery_status: { $in: ['delivered', 'service center delivered'] }
                }).sort({ assignedAt: -1 }).toArray();

                res.send(completedParcels);
            } catch (error) {
                console.error("Error loading completed parcels:", error);
                res.status(500).send({ message: "Failed to load completed deliveries" });
            }
        });

        app.patch('/parcels/:id/cashout', async (req, res) => {
            const { id } = req.params;

            try {
                const result = await parcelCollection.updateOne(
                    {
                        _id: new ObjectId(id),
                        cashOutStatus: { $exists: false } // 💡 Prevent double update
                    },
                    {
                        $set: {
                            cashOutStatus: 'cashed-out',
                            cashedOutAt: new Date()
                        }
                    }
                );

                if (result.modifiedCount === 0) {
                    return res.status(400).send({ message: 'Cashout already requested or invalid parcel' });
                }

                res.send({ message: 'Cashout requested', result });
            } catch (error) {
                console.error('Cashout error:', error);
                res.status(500).send({ message: 'Cashout request failed' });
            }
        });


        // ✅ GET /admin/parcel-status-counts
        app.get('/admin/parcel-status-counts', verifyFBToken, verifyAdmin, async (req, res) => {    // /parcels/delivery/status-count
            try {
                const result = await parcelCollection.aggregate([
                    {
                        $group: {
                            _id: "$delivery_status",
                            count: { $sum: 1 }
                        }
                    },
                    {
                        $project: {
                            _id: 0,
                            status: "$_id",
                            count: 1
                        }
                    }
                ]).toArray();

                res.send(result);
            } catch (err) {
                console.error('Error counting parcel statuses:', err);
                res.status(500).send({ message: 'Server error' });
            }
        })

        // GET /rider/status-summary?email=md@rafi.com
        app.get('/rider/status-summary', verifyFBToken, verifyRider, async (req, res) => {
            try {
                const email = req.query.email;

                const result = await parcelCollection.aggregate([
                    { $match: { assignedRiderEmail: email } },
                    {
                        $group: {
                            _id: "$delivery_status",
                            count: { $sum: 1 }
                        }
                    },
                    {
                        $project: {
                            status: "$_id",
                            count: 1,
                            _id: 0
                        }
                    }
                ]).toArray();

                res.send(result);
            } catch (err) {
                res.status(500).send({ message: 'Error retrieving status summary', error: err.message });
            }
        });




        app.get('/users/search', async (req, res) => {
            const emailQuery = req.query.email;
            if (!emailQuery) {
                return res.status(400).send({ message: "missing email query" })
            }

            const regex = new RegExp(emailQuery, "i");

            try {
                const users = await userCollection
                    .find({ email: { $regex: regex } })
                    .project({ email: 1, created_at: 1, role: 1 })
                    .limit(10)
                    .toArray();
                res.send(users)
            } catch (error) {
                console.error("Error user", error)
                res.status(500).send({ message: "error searching users" })
            }
        })

        app.get('/users/:email/role', verifyFBToken, async (req, res) => {
            try {
                const email = req.params.email
                if (!email) {
                    return res.status(400).send({ message: "Email is required" })
                }
                const user = await userCollection.findOne({ email });
                if (!user) {
                    return res.status(400).send({ message: "User not found" })
                }
                res.send({ role: user.role || 'user' })
            } catch (error) {
                console.error(error)
                res.status(500).send({ message: "Failed to grt role" })
            }
        });


        app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
            const { id } = req.params;
            const { role } = req.body;
            if (!['admin', 'user'].includes(role)) {
                return res.status(400).send({ message: "invalid role" })
            }

            try {
                const result = await userCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { role } }
                );
                res.send({ message: `user role update to ${role}`, result })
            } catch (error) {
                console.error(error)
                res.status(500).send({ message: "Failed to update user role" })
            }
        })








        app.listen(port, () => console.log(`Server running on port ${port}`));

        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);








app.get('/', (req, res) => {
    res.send("Parcel server is running")
})
app.listen(port, () => {
    console.log(`Server is listening on port ${port}`)
})